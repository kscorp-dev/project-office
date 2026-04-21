/**
 * 통합 테스트용 fixture 헬퍼
 *
 * - 테스트마다 격리된 사용자/부서/템플릿 생성
 * - 테스트 종료 후 정리
 *
 * 각 fixture ID는 테스트-scoped prefix를 가져 다른 테스트와 충돌하지 않는다.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const prisma = new PrismaClient();

export function uniqueId(prefix = 't'): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function createTestUser(overrides: Partial<{
  employeeId: string;
  email: string;
  name: string;
  role: UserRole;
  departmentId: string;
}> = {}) {
  const eid = overrides.employeeId ?? uniqueId('emp');
  const password = await bcrypt.hash('TestPass@1234', 4); // 테스트용 낮은 라운드
  return prisma.user.create({
    data: {
      employeeId: eid,
      email: overrides.email ?? `${eid}@test.local`,
      name: overrides.name ?? `TestUser-${eid}`,
      password,
      role: overrides.role ?? UserRole.user,
      status: 'active',
      departmentId: overrides.departmentId,
    },
  });
}

export async function createTestDepartment(overrides: Partial<{
  name: string;
  code: string;
  parentId: string | null;
  depth: number;
}> = {}) {
  const code = overrides.code ?? uniqueId('DEPT').toUpperCase().replace(/-/g, '_');
  return prisma.department.create({
    data: {
      name: overrides.name ?? `TestDept-${code}`,
      code,
      parentId: overrides.parentId ?? null,
      depth: overrides.depth ?? 0,
      sortOrder: 0,
    },
  });
}

export async function createTestTemplate() {
  const code = uniqueId('TPL').toUpperCase();
  return prisma.approvalTemplate.create({
    data: {
      name: `TestTpl-${code}`,
      code,
      category: 'test',
      sortOrder: 0,
    },
  });
}

/**
 * approval flow 준비 — drafter + approvers + 문서 생성(pending 상태).
 * steps: 결재선 개수 (각 결재자 1명).
 */
export async function createPendingApproval(steps: number) {
  const drafter = await createTestUser();
  const approvers = await Promise.all(
    Array.from({ length: steps }, () => createTestUser()),
  );
  const template = await createTestTemplate();

  const doc = await prisma.approvalDocument.create({
    data: {
      docNumber: `TEST-${uniqueId('DOC')}`,
      templateId: template.id,
      drafterId: drafter.id,
      title: 'Integration test doc',
      content: '테스트 내용',
      urgency: 'normal',
      status: 'pending',
      currentStep: 1,
      submittedAt: new Date(),
      lines: {
        create: approvers.map((u, i) => ({
          step: i + 1,
          approverId: u.id,
          type: 'serial',
          status: 'pending',
        })),
      },
    },
    include: { lines: true },
  });

  return { drafter, approvers, template, doc };
}

export async function cleanupApproval(docId: string) {
  // onDelete: Cascade가 없어서 lines/references를 먼저 삭제
  await prisma.approvalLine.deleteMany({ where: { documentId: docId } });
  await prisma.approvalReference.deleteMany({ where: { documentId: docId } });
  await prisma.approvalAttachment.deleteMany({ where: { documentId: docId } });
  await prisma.approvalDocument.delete({ where: { id: docId } }).catch(() => {});
}

export async function cleanupUsers(ids: string[]) {
  // 관련 cascade 데이터가 없는 테스트 유저만 대상
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export async function cleanupDepartments(ids: string[]) {
  await prisma.department.deleteMany({ where: { id: { in: ids } } });
}
