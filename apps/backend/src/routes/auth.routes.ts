import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authService, AppError } from '../services/auth.service';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/auditLog';
import { config } from '../config';

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
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

export default router;
