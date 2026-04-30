import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate, validateQuery } from '../middleware/validate';
import { createAuditLog } from '../middleware/auditLog';
import { AppError } from '../services/auth.service';
import { qs, qsOpt } from '../utils/query';
import { logger } from '../config/logger';

const router = Router();

// 쿼리 스키마
const listUsersQuery = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['name', 'employeeId', 'createdAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

/** 명시적 화이트리스트 — strict 모드로 unknown 필드(employeeId/password/loginFailCount 등) 거부 (audit 10B H3) */
const updateUserSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  position: z.string().max(50).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  role: z.enum(['super_admin', 'admin', 'dept_admin', 'user', 'guest']).optional(),
  status: z.enum(['active', 'inactive', 'locked', 'pending']).optional(),
}).strict();

// GET /users - 사용자 목록
router.get('/', authenticate, validateQuery(listUsersQuery), async (req: Request, res: Response) => {
  try {
    const { page, limit, search, departmentId, role, status, sortBy, sortOrder } = req.query as unknown as z.infer<typeof listUsersQuery>;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (departmentId) where.departmentId = departmentId;
    if (role) where.role = role;
    if (status) where.status = status;

    // dept_admin은 자기 부서만 조회 가능
    if (req.user!.role === 'dept_admin') {
      where.departmentId = req.user!.departmentId;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, employeeId: true, email: true, name: true, phone: true,
          role: true, status: true, position: true, profileImage: true,
          departmentId: true, lastLoginAt: true, createdAt: true,
          department: { select: { id: true, name: true, code: true } },
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// GET /users/:id - 사용자 상세
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: qs(req.params.id) },
      select: {
        id: true, employeeId: true, email: true, name: true, phone: true,
        role: true, status: true, position: true, profileImage: true,
        departmentId: true, lastLoginAt: true, createdAt: true, updatedAt: true,
        department: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
      return;
    }

    res.json({ success: true, data: user });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// PATCH /users/:id - 사용자 수정 (관리자)
router.patch('/:id', authenticate, authorize('super_admin', 'admin'), validate(updateUserSchema), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: qs(req.params.id) } });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다' } });
      return;
    }

    // super_admin 역할 변경은 super_admin만 가능
    if (req.body.role === 'super_admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '슈퍼관리자 역할 부여 권한이 없습니다' } });
      return;
    }

    const user = await prisma.user.update({
      where: { id: qs(req.params.id) },
      data: req.body,
      select: {
        id: true, employeeId: true, email: true, name: true, phone: true,
        role: true, status: true, position: true, departmentId: true,
        department: { select: { id: true, name: true, code: true } },
      },
    });

    const action = req.body.role !== existing.role ? 'role_change' : 'user_update';
    await createAuditLog({
      req, action, resourceType: 'user', resourceId: user.id,
      details: { before: { role: existing.role, status: existing.status }, after: req.body },
      riskLevel: req.body.role ? 'high' : 'low',
    });

    res.json({ success: true, data: user });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

export default router;
