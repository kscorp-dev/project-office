/**
 * CCTV 카메라 접근 권한 (CAM-007)
 *
 * 허용 규칙:
 *   - super_admin / admin 은 언제나 허용
 *   - 카메라.isPublic=true → 누구나 허용
 *   - CameraPermission에 {subjectType=user, subjectId=userId} → 허용
 *   - CameraPermission에 {subjectType=department, subjectId=user.departmentId} → 허용
 *   - CameraPermission에 {subjectType=role, subjectId=user.role} → 허용
 *   - level='control'은 PTZ 제어 허용, 'view'는 시청만
 */
import prisma from '../config/prisma';

export interface AccessUser {
  id: string;
  role: string;
  departmentId: string | null;
}

export type AccessLevel = 'none' | 'view' | 'control';

/** 특정 카메라에 대한 사용자의 최대 권한 레벨 반환 */
export async function getCameraAccessLevel(
  cameraId: string,
  user: AccessUser,
): Promise<AccessLevel> {
  // 관리자는 control 권한
  if (user.role === 'super_admin' || user.role === 'admin') return 'control';

  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { id: true, isActive: true, isPublic: true },
  });
  if (!camera || !camera.isActive) return 'none';

  // 공개 카메라는 누구나 view
  if (camera.isPublic) return 'view';

  // 명시적 권한
  const perms = await prisma.cameraPermission.findMany({
    where: {
      cameraId,
      OR: [
        { subjectType: 'user', subjectId: user.id },
        ...(user.departmentId
          ? [{ subjectType: 'department' as const, subjectId: user.departmentId }]
          : []),
        { subjectType: 'role', subjectId: user.role },
      ],
    },
  });

  if (perms.length === 0) return 'none';
  // control > view
  return perms.some((p) => p.level === 'control') ? 'control' : 'view';
}

/** 사용자가 볼 수 있는 카메라 ID 목록 */
export async function listAllowedCameraIds(user: AccessUser): Promise<string[] | 'all'> {
  if (user.role === 'super_admin' || user.role === 'admin') return 'all';

  const publicIds = (
    await prisma.camera.findMany({
      where: { isActive: true, isPublic: true },
      select: { id: true },
    })
  ).map((c) => c.id);

  const permissionCameraIds = (
    await prisma.cameraPermission.findMany({
      where: {
        OR: [
          { subjectType: 'user', subjectId: user.id },
          ...(user.departmentId
            ? [{ subjectType: 'department' as const, subjectId: user.departmentId }]
            : []),
          { subjectType: 'role', subjectId: user.role },
        ],
      },
      select: { cameraId: true },
    })
  ).map((p) => p.cameraId);

  return Array.from(new Set([...publicIds, ...permissionCameraIds]));
}
