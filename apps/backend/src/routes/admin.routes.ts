import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { config } from '../config';
import { qs, qsOpt } from '../utils/query';

const router = Router();

// 모든 관리자 라우트에 인증 + 권한 검사 적용
router.use(authenticate, authorize('super_admin', 'admin'));

// ===== 모듈 관리 =====

// GET /admin/modules - 모듈 목록
router.get('/modules', async (_req: Request, res: Response) => {
  try {
    const modules = await prisma.featureModule.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: modules });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /admin/modules/:id - 모듈 활성화/비활성화
router.patch('/modules/:id', async (req: Request, res: Response) => {
  try {
    const module = await prisma.featureModule.findUnique({ where: { id: qs(req.params.id) } });
    if (!module) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '모듈을 찾을 수 없습니다' } });
      return;
    }

    const updated = await prisma.featureModule.update({
      where: { id: qs(req.params.id) },
      data: {
        isEnabled: req.body.isEnabled !== undefined ? req.body.isEnabled : !module.isEnabled,
      },
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 시스템 설정 =====

// GET /admin/settings - 시스템 설정 전체
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
    res.json({ success: true, data: settings });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PUT /admin/settings/:key - 설정 값 변경
router.put('/settings/:key', async (req: Request, res: Response) => {
  try {
    if (req.body.value === undefined) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '설정 값을 입력해주세요' } });
      return;
    }

    const setting = await prisma.systemSetting.upsert({
      where: { key: qs(req.params.key) },
      update: { value: String(req.body.value), updatedBy: req.user!.id },
      create: { key: qs(req.params.key), value: String(req.body.value), updatedBy: req.user!.id },
    });

    res.json({ success: true, data: setting });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

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

    res.status(201).json({ success: true, data: newUser });
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

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

    const updated = await prisma.user.update({
      where: { id: qs(req.params.id) },
      data: { role: req.body.role },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    res.json({ success: true, data: updated });
  } catch {
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

    const updated = await prisma.user.update({
      where: { id: qs(req.params.id) },
      data: { status: req.body.status },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    res.json({ success: true, data: updated });
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 대시보드 통계 =====

// GET /admin/stats/dashboard - 관리자 통계
router.get('/stats/dashboard', async (_req: Request, res: Response) => {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
