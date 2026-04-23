import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authService, AppError } from '../services/auth.service';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/auditLog';
import { config } from '../config';
import { logger } from '../config/logger';

const router = Router();

// Rate Limiters
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  max: config.rateLimit.login.max,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요' } },
});

const registerLimiter = rateLimit({
  windowMs: config.rateLimit.register.windowMs,
  max: config.rateLimit.register.max,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '회원가입 요청이 너무 많습니다' } },
});

// Schemas
const registerSchema = z.object({
  employeeId: z.string().min(1).max(50),
  email: z.string().email(),
  name: z.string().min(2).max(50),
  password: z.string().min(8).max(100)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/, '영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다'),
  departmentId: z.string().uuid().optional(),
  position: z.string().max(50).optional(),
  phone: z.string().regex(/^01[0-9]\d{7,8}$/).optional(),
});

const loginSchema = z.object({
  employeeId: z.string().min(1),
  password: z.string().min(1),
  deviceInfo: z.object({
    deviceId: z.string(),
    deviceType: z.enum(['web', 'ios', 'android']),
    deviceName: z.string(),
    pushToken: z.string().optional(),
  }).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/),
});

// POST /auth/register
router.post('/register', registerLimiter, validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const user = await authService.register(req.body);
    await createAuditLog({ req, action: 'user_create', resourceType: 'user', resourceId: user.id });
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// POST /auth/login
router.post('/login', loginLimiter, validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const result = await authService.login(req.body);
    await createAuditLog({ req, action: 'login', resourceType: 'user', resourceId: result.user.id });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) {
      await createAuditLog({ req, action: 'login_failed', result: 'failure', riskLevel: 'medium', details: { employeeId: req.body.employeeId } });
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: { code: 'MISSING_TOKEN', message: '리프레시 토큰이 필요합니다' } });
      return;
    }
    const tokens = await authService.refreshToken(refreshToken);
    await createAuditLog({ req, action: 'token_refresh' });
    res.json({ success: true, data: tokens });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    await authService.logout(req.user!.id, req.body.refreshToken);
    await createAuditLog({ req, action: 'logout' });
    res.json({ success: true, data: { message: '로그아웃 되었습니다' } });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// PUT /auth/password
router.put('/password', authenticate, validate(changePasswordSchema), async (req: Request, res: Response) => {
  try {
    await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    await createAuditLog({ req, action: 'password_change', riskLevel: 'high' });
    res.json({ success: true, data: { message: '비밀번호가 변경되었습니다' } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await import('../config/prisma').then(m => m.default.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, employeeId: true, email: true, name: true, phone: true,
        role: true, status: true, position: true, profileImage: true,
        departmentId: true, lastLoginAt: true, createdAt: true, updatedAt: true,
        department: { select: { id: true, name: true, code: true } },
      },
    }));
    res.json({ success: true, data: user });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// ===== 초대 / 비밀번호 재설정 =====

import {
  createInvite,
  verifyInvite,
  acceptInvite,
  requestPasswordReset,
  verifyPasswordResetToken,
  resetPasswordWithToken,
} from '../services/auth-token.service';
import { authorize } from '../middleware/authorize';

const inviteSchema = z.object({
  email: z.string().email(),
  employeeId: z.string().min(1).max(50),
  name: z.string().min(1).max(50),
  role: z.enum(['user', 'dept_admin', 'admin', 'super_admin']).optional(),
  position: z.string().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  phone: z.string().regex(/^01[0-9]\d{7,8}$/).optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// POST /auth/invite (관리자) — 사용자 초대 이메일 발송
router.post(
  '/invite',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(inviteSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await createInvite({
        email: req.body.email,
        employeeId: req.body.employeeId,
        name: req.body.name,
        role: req.body.role,
        position: req.body.position,
        departmentId: req.body.departmentId,
        phone: req.body.phone,
        hireDate: req.body.hireDate ? new Date(`${req.body.hireDate}T00:00:00Z`) : undefined,
        createdById: req.user!.id,
      });
      await createAuditLog({ req, action: 'user_create', resourceType: 'user', resourceId: req.body.email });
      res.status(201).json({ success: true, data: { tokenId: result.tokenId, expiresAt: result.expiresAt } });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// GET /auth/invite/:token — 초대 토큰 검증 (가입 페이지에서 미리 정보 표시)
router.get('/invite/:token', async (req: Request, res: Response) => {
  try {
    const info = await verifyInvite(String(req.params.token));
    res.json({ success: true, data: info });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /auth/invite/:token/accept — 비번 설정하고 계정 활성화
const acceptSchema = z.object({
  password: z.string().min(8).max(100)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/, '영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다'),
});
router.post(
  '/invite/:token/accept',
  registerLimiter,
  validate(acceptSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await acceptInvite(String(req.params.token), req.body.password);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// POST /auth/forgot-password — 비번 재설정 메일 발송 (존재하든 말든 204 반환)
const forgotSchema = z.object({ email: z.string().email() });
router.post('/forgot-password', validate(forgotSchema), async (req: Request, res: Response) => {
  try {
    await requestPasswordReset(req.body.email);
    res.json({ success: true }); // 존재 여부 누출 방지
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.json({ success: true });
  }
});

// GET /auth/reset-password/:token — 재설정 토큰 검증
router.get('/reset-password/:token', async (req: Request, res: Response) => {
  try {
    const info = await verifyPasswordResetToken(String(req.params.token));
    res.json({ success: true, data: { email: info.email } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /auth/reset-password/:token — 새 비번 설정
const resetSchema = z.object({
  password: z.string().min(8).max(100)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/, '영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다'),
});
router.post(
  '/reset-password/:token',
  registerLimiter,
  validate(resetSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await resetPasswordWithToken(String(req.params.token), req.body.password);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

export default router;
