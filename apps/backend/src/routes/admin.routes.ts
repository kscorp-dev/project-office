import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { logger } from '../config/logger';
import { config } from '../config';
import { qs, qsOpt } from '../utils/query';

const router = Router();

// 모든 관리자 라우트에 인증 + 권한 검사 적용
router.use(authenticate, authorize('super_admin', 'admin'));

// ===== 모듈 관리 =====

// GET /admin/modules - 모듈 목록 (admin/super_admin)
// sortOrder 기준 정렬 → 기획 순서(auth, approval, messenger, cctv, attendance ...)
router.get('/modules', async (req: Request, res: Response) => {
  try {
    const modules = await prisma.featureModule.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: modules });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /admin/modules/:id - 모듈 활성화/비활성화
// - critical 모듈(cctv/parking/attendance 등)은 super_admin만 전환 가능
// - isEnabled 미지정 시 현재 값 반전
router.patch('/modules/:id', async (req: Request, res: Response) => {
  try {
    const module = await prisma.featureModule.findUnique({ where: { id: qs(req.params.id) } });
    if (!module) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '모듈을 찾을 수 없습니다' } });
      return;
    }

    // critical 모듈은 super_admin 전용
    if (module.isCritical && req.user!.role !== 'super_admin') {
      res.status(403).json({
        success: false,
        error: {
          code: 'CRITICAL_MODULE_SUPER_ADMIN_ONLY',
          message: `${module.displayName}은(는) 슈퍼 관리자만 제어할 수 있습니다`,
        },
      });
      return;
    }

    const nextEnabled = req.body.isEnabled !== undefined ? Boolean(req.body.isEnabled) : !module.isEnabled;

    const updated = await prisma.featureModule.update({
      where: { id: qs(req.params.id) },
      data: { isEnabled: nextEnabled },
    });

    // 감사 로그
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'module_toggle',
        resourceType: 'feature_module',
        resourceId: module.id,
        details: {
          module: module.name,
          isEnabled: nextEnabled,
          isCritical: module.isCritical,
        },
        ipAddress: req.ip,
      },
    }).catch(() => { /* audit 실패가 토글을 막지 않도록 */ });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 시스템 설정 =====

// GET /admin/settings - 시스템 설정 전체
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ── role-gate 헬퍼: 설정 편집 권한 확인
// minRole 이 super_admin 인 설정은 super_admin 만 수정 가능
function canEditSetting(minRole: string, userRole: string): boolean {
  if (minRole === 'super_admin') return userRole === 'super_admin';
  // admin / 그 외는 admin/super_admin 둘 다 허용
  return userRole === 'admin' || userRole === 'super_admin';
}

// PUT /admin/settings/:key - 설정 값 변경 (key로 지정, 존재하지 않으면 생성)
router.put('/settings/:key', async (req: Request, res: Response) => {
  try {
    if (req.body.value === undefined) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '설정 값을 입력해주세요' } });
      return;
    }

    const existing = await prisma.systemSetting.findUnique({ where: { key: qs(req.params.key) } });
    if (existing && !canEditSetting(existing.minRole, req.user!.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'SETTING_SUPER_ADMIN_ONLY', message: '이 설정은 슈퍼 관리자만 변경할 수 있습니다' },
      });
      return;
    }

    const setting = await prisma.systemSetting.upsert({
      where: { key: qs(req.params.key) },
      update: { value: String(req.body.value), updatedBy: req.user!.id },
      create: { key: qs(req.params.key), value: String(req.body.value), updatedBy: req.user!.id },
    });

    // 감사 로그
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'settings_change',
        resourceType: 'system_setting',
        resourceId: setting.id,
        details: { key: setting.key, value: setting.value, minRole: setting.minRole },
        ipAddress: req.ip,
      },
    }).catch(() => { /* ignore */ });

    res.json({ success: true, data: setting });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /admin/settings/:id - 설정 값 변경 (id로 지정, 기존 설정만 업데이트)
// 프론트 AdminConsole 이 id로 호출해서 PUT과 별도로 제공한다.
router.patch('/settings/:id', async (req: Request, res: Response) => {
  try {
    if (req.body.value === undefined) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '설정 값을 입력해주세요' } });
      return;
    }
    const existing = await prisma.systemSetting.findUnique({ where: { id: qs(req.params.id) } });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '설정을 찾을 수 없습니다' } });
      return;
    }
    if (!canEditSetting(existing.minRole, req.user!.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'SETTING_SUPER_ADMIN_ONLY', message: '이 설정은 슈퍼 관리자만 변경할 수 있습니다' },
      });
      return;
    }
    const setting = await prisma.systemSetting.update({
      where: { id: existing.id },
      data: { value: String(req.body.value), updatedBy: req.user!.id },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'settings_change',
        resourceType: 'system_setting',
        resourceId: setting.id,
        details: { key: setting.key, value: setting.value, minRole: setting.minRole },
        ipAddress: req.ip,
      },
    }).catch(() => { /* ignore */ });
    res.json({ success: true, data: setting });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 보안 / 세션 관리 (super_admin 전용) =====

// POST /admin/security/revoke-all-sessions
// 모든 사용자의 유효 RefreshToken을 일괄 revoke → 다음 토큰 갱신 시 강제 재로그인
// 보안 사고 대응용. super_admin 전용.
router.post(
  '/security/revoke-all-sessions',
  async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      res.status(403).json({
        success: false,
        error: { code: 'SUPER_ADMIN_ONLY', message: '슈퍼 관리자만 실행 가능합니다' },
      });
      return;
    }
    try {
      const result = await prisma.refreshToken.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'logout',
          resourceType: 'refresh_token_bulk',
          details: { scope: 'all', revokedCount: result.count },
          ipAddress: req.ip,
          riskLevel: 'high',
        },
      }).catch(() => { /* ignore */ });
      res.json({ success: true, data: { revokedCount: result.count } });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// POST /admin/security/revoke-user-sessions/:userId
// 특정 사용자의 모든 세션 강제 종료. super_admin 전용.
router.post(
  '/security/revoke-user-sessions/:userId',
  async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      res.status(403).json({
        success: false,
        error: { code: 'SUPER_ADMIN_ONLY', message: '슈퍼 관리자만 실행 가능합니다' },
      });
      return;
    }
    try {
      const targetId = qs(req.params.userId);
      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
        return;
      }
      const result = await prisma.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'logout',
          resourceType: 'refresh_token_user',
          resourceId: targetId,
          details: { targetUser: target.employeeId, revokedCount: result.count },
          ipAddress: req.ip,
          riskLevel: 'medium',
        },
      }).catch(() => { /* ignore */ });
      res.json({ success: true, data: { revokedCount: result.count } });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// ===== 사용자 관리 =====

// POST /admin/users - 관리자가 직접 직원 등록
const createUserSchema = z.object({
  employeeId: z.string().min(2).max(20),
  name: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role: z.enum(['super_admin', 'admin', 'dept_admin', 'user']).default('user'),
  departmentId: z.string().optional(),
  position: z.string().optional(),
  phone: z.string().optional(),

  /** 직원 등록과 함께 WorkMail 메일박스 자동 생성 옵션 */
  createMailbox: z.boolean().optional(),
  /** 메일박스 로컬파트 (생략 시 employeeId 소문자 변환) */
  mailboxUsername: z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/).optional(),
  /** WorkMail 초기 비번 (생략 시 자동 생성) */
  mailboxPassword: z.string().min(8).max(64).optional(),
  /** 메일박스 쿼터 MB */
  mailboxQuotaMB: z.number().int().min(100).max(51200).optional(),
  /** 전체 주소록에서 숨김 */
  mailboxHiddenFromGAL: z.boolean().optional(),
});

router.post('/users', async (req: Request, res: Response) => {
  try {
    const data = createUserSchema.parse(req.body);

    // super_admin 역할 부여는 super_admin만 가능
    if (data.role === 'super_admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'super_admin 역할 부여 권한이 없습니다' } });
      return;
    }

    // 중복 확인
    const existing = await prisma.user.findFirst({
      where: { OR: [{ employeeId: data.employeeId }, { email: data.email }] },
    });
    if (existing) {
      const field = existing.employeeId === data.employeeId ? '사번' : '이메일';
      res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: `이미 사용 중인 ${field}입니다` } });
      return;
    }

    // 부서 존재 확인
    if (data.departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!dept) {
        res.status(400).json({ success: false, error: { code: 'INVALID_DEPT', message: '존재하지 않는 부서입니다' } });
        return;
      }
    }

    const hashedPassword = await bcrypt.hash(data.password, config.bcrypt.saltRounds);

    const newUser = await prisma.user.create({
      data: {
        employeeId: data.employeeId,
        name: data.name,
        email: data.email,
        password: hashedPassword,
        role: data.role as any,
        status: 'active',  // 관리자가 등록하므로 바로 활성화
        position: data.position,
        phone: data.phone,
        departmentId: data.departmentId || null,
      },
      select: {
        id: true, employeeId: true, name: true, email: true, role: true, status: true,
        position: true, phone: true,
        department: { select: { id: true, name: true } },
        createdAt: true,
      },
    });

    // 메일박스 자동 생성 (옵션) — User 생성 성공 후에만 시도
    let mailboxResult: {
      email: string;
      workmailUserId: string;
      mailAccountId: string;
      temporaryPassword: string | null;
    } | null = null;
    let mailboxError: string | null = null;

    if (data.createMailbox) {
      try {
        const { getWorkMailService } = await import('../services/workmail.service');
        const { encryptMailPassword, generateStrongPassword } = await import('../utils/mailCrypto');

        const wm = getWorkMailService();
        const username = (data.mailboxUsername || data.employeeId).toLowerCase();
        if (!/^[a-z0-9._-]{1,64}$/.test(username)) {
          throw new Error('메일박스 사용자명은 영소문자/숫자/._- 만 허용됩니다');
        }
        const mailPw = data.mailboxPassword ?? generateStrongPassword(20);

        const { userId: workmailUserId, email } = await wm.createMailbox({
          username,
          password: mailPw,
          displayName: data.name,
          hiddenFromGAL: data.mailboxHiddenFromGAL,
        });

        // 원하는 쿼터가 있으면 즉시 적용
        if (data.mailboxQuotaMB) {
          await wm.updateQuota(workmailUserId, data.mailboxQuotaMB).catch(() => { /* ignore */ });
        }

        const account = await prisma.mailAccount.create({
          data: {
            userId: newUser.id,
            email,
            displayName: data.name,
            workmailUserId,
            quotaMB: data.mailboxQuotaMB ?? 51200,
            encryptedPassword: encryptMailPassword(mailPw),
          },
        });

        await prisma.mailAdminLog.create({
          data: {
            actorId: req.user!.id,
            targetEmail: email,
            action: 'create',
            details: {
              workmailUserId,
              linkedUserId: newUser.id,
              autoGenerated: !data.mailboxPassword,
              viaUserCreation: true,
            },
          },
        }).catch(() => { /* ignore */ });

        mailboxResult = {
          email,
          workmailUserId,
          mailAccountId: account.id,
          temporaryPassword: data.mailboxPassword ? null : mailPw,
        };
      } catch (err) {
        mailboxError = (err as Error).message || '메일박스 생성 실패';
        // User는 이미 생성됐으므로 계속 진행, 에러 정보만 응답에 포함
      }
    }

    res.status(201).json({
      success: true,
      data: newUser,
      mailbox: mailboxResult,
      mailboxError,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0]?.message || '입력값을 확인해주세요' } });
      return;
    }
    console.error('Create user error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /admin/users - 전체 사용자 목록 (검색, 역할 필터, 상태 필터, 페이지네이션)
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const search = qsOpt(req.query.search);
    const role = qsOpt(req.query.role);
    const status = qsOpt(req.query.status);

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) {
      where.role = role;
    }
    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          employeeId: true,
          role: true,
          status: true,
          position: true,
          department: { select: { id: true, name: true } },
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, data: users, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ── "마지막 super_admin" 가드 헬퍼
// 현재 active 상태인 super_admin 이 유일한데 그를 강등/비활성화하려는 경우 차단
async function ensureNotLastSuperAdmin(targetUserId: string, action: 'role_change' | 'status_change'): Promise<string | null> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true, status: true } });
  if (!target || target.role !== 'super_admin' || target.status !== 'active') return null; // 대상이 active super_admin 이 아니면 OK
  const count = await prisma.user.count({ where: { role: 'super_admin', status: 'active' } });
  if (count > 1) return null;
  return action === 'role_change'
    ? '마지막 슈퍼 관리자입니다. 먼저 다른 사용자를 슈퍼 관리자로 지정해야 합니다.'
    : '마지막 슈퍼 관리자입니다. 비활성화/잠금할 수 없습니다.';
}

// PATCH /admin/users/:id/role - 역할 변경
router.patch('/users/:id/role', async (req: Request, res: Response) => {
  try {
    const validRoles = ['super_admin', 'admin', 'dept_admin', 'user'];
    if (!req.body.role || !validRoles.includes(req.body.role)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '유효하지 않은 역할입니다' } });
      return;
    }

    // super_admin 역할 변경은 super_admin만 가능
    if (req.body.role === 'super_admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'super_admin 역할 변경 권한이 없습니다' } });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: qs(req.params.id) } });
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
      return;
    }

    // super_admin → 다른 역할로 강등하려는 경우, 마지막 super_admin 보호
    if (user.role === 'super_admin' && req.body.role !== 'super_admin') {
      const guard = await ensureNotLastSuperAdmin(user.id, 'role_change');
      if (guard) {
        res.status(400).json({ success: false, error: { code: 'LAST_SUPER_ADMIN', message: guard } });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: qs(req.params.id) },
      data: { role: req.body.role },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    // 감사 로그
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'role_change',
        resourceType: 'user',
        resourceId: user.id,
        details: { targetUser: user.employeeId, before: user.role, after: req.body.role },
        ipAddress: req.ip,
        riskLevel: req.body.role === 'super_admin' ? 'high' : 'medium',
      },
    }).catch(() => { /* ignore */ });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /admin/users/:id/status - 상태 변경 (active/inactive/locked)
router.patch('/users/:id/status', async (req: Request, res: Response) => {
  try {
    const validStatuses = ['active', 'inactive', 'locked'];
    if (!req.body.status || !validStatuses.includes(req.body.status)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '유효하지 않은 상태값입니다' } });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: qs(req.params.id) } });
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
      return;
    }

    // 자기 자신의 상태는 변경 불가
    if (user.id === req.user!.id) {
      res.status(400).json({ success: false, error: { code: 'SELF_MODIFY', message: '자신의 상태는 변경할 수 없습니다' } });
      return;
    }

    // super_admin 을 active 외 상태로 바꾸려는 경우, 마지막 super_admin 보호
    if (user.role === 'super_admin' && req.body.status !== 'active') {
      const guard = await ensureNotLastSuperAdmin(user.id, 'status_change');
      if (guard) {
        res.status(400).json({ success: false, error: { code: 'LAST_SUPER_ADMIN', message: guard } });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: qs(req.params.id) },
      data: { status: req.body.status },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /admin/users/:id/audit-logs - 특정 사용자의 모든 감사 로그 (super_admin 전용)
// 멤버별 행위 이력을 한눈에 보기 위한 전용 엔드포인트.
router.get('/users/:id/audit-logs', async (req: Request, res: Response) => {
  if (req.user!.role !== 'super_admin') {
    res.status(403).json({
      success: false,
      error: { code: 'SUPER_ADMIN_ONLY', message: '슈퍼 관리자만 조회 가능합니다' },
    });
    return;
  }
  try {
    const targetId = qs(req.params.id);
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = Math.min(parseInt(qs(req.query.limit)) || 30, 100);
    const action = qsOpt(req.query.action);

    const where: any = { userId: targetId };
    if (action) where.action = { contains: action, mode: 'insensitive' };

    const [logs, total, user] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
      prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, email: true, employeeId: true, role: true, status: true, lastLoginAt: true },
      }),
    ]);
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
      return;
    }
    res.json({
      success: true,
      data: { user, logs },
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 감사 로그 =====

// GET /admin/audit-logs - 감사 로그 (action 필터, user 필터, 날짜 범위, 페이지네이션)
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 50;
    const action = qsOpt(req.query.action);
    const userId = qsOpt(req.query.userId);
    const startDate = qsOpt(req.query.startDate);
    const endDate = qsOpt(req.query.endDate);

    const where: any = {};
    if (action) {
      where.action = { contains: action, mode: 'insensitive' };
    }
    if (userId) {
      where.userId = userId;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ success: true, data: logs, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 대시보드 통계 =====

// GET /admin/stats/dashboard - 관리자 통계
router.get('/stats/dashboard', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalUsers, activeUsers, todayLogins, pendingApprovals] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.auditLog.count({
        where: {
          action: 'login',
          createdAt: { gte: today, lt: tomorrow },
        },
      }),
      prisma.approvalDocument.count({
        where: { status: 'pending' },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        todayLogins,
        pendingApprovals,
      },
    });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
