import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';

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
    const module = await prisma.featureModule.findUnique({ where: { id: req.params.id } });
    if (!module) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '모듈을 찾을 수 없습니다' } });
      return;
    }

    const updated = await prisma.featureModule.update({
      where: { id: req.params.id },
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
      where: { key: req.params.key },
      update: { value: String(req.body.value), updatedBy: req.user!.id },
      create: { key: req.params.key, value: String(req.body.value), updatedBy: req.user!.id },
    });

    res.json({ success: true, data: setting });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 사용자 관리 =====

// GET /admin/users - 전체 사용자 목록 (검색, 역할 필터, 상태 필터, 페이지네이션)
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string | undefined;
    const role = req.query.role as string | undefined;
    const status = req.query.status as string | undefined;

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

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
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

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
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
      where: { id: req.params.id },
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

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
