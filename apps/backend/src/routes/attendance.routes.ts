import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';

const router = Router();
router.use(checkModule('attendance'));

// ===== 출퇴근 =====

const checkSchema = z.object({
  type: z.enum(['check_in', 'check_out']),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  note: z.string().max(200).optional(),
});

// POST /attendance/check - 출퇴근 기록
router.post('/check', authenticate, validate(checkSchema), async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 오늘 이미 같은 타입 기록이 있는지 확인
    const existing = await prisma.attendance.findFirst({
      where: {
        userId: req.user!.id,
        type: req.body.type,
        checkTime: { gte: today, lt: tomorrow },
      },
    });

    if (existing) {
      res.status(400).json({ success: false, error: { code: 'ALREADY_CHECKED', message: `이미 ${req.body.type === 'check_in' ? '출근' : '퇴근'} 처리되었습니다` } });
      return;
    }

    const attendance = await prisma.attendance.create({
      data: {
        userId: req.user!.id,
        type: req.body.type,
        checkTime: new Date(),
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip,
        deviceType: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'web',
        note: req.body.note,
      },
    });

    res.status(201).json({ success: true, data: attendance });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /attendance/today - 오늘 내 출퇴근 현황
router.get('/today', authenticate, async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const records = await prisma.attendance.findMany({
      where: { userId: req.user!.id, checkTime: { gte: today, lt: tomorrow } },
      orderBy: { checkTime: 'asc' },
    });

    const checkIn = records.find(r => r.type === 'check_in');
    const checkOut = records.find(r => r.type === 'check_out');

    let workHours = null;
    if (checkIn && checkOut) {
      const diff = checkOut.checkTime.getTime() - checkIn.checkTime.getTime();
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      workHours = `${hours}시간 ${minutes}분`;
    }

    res.json({ success: true, data: { checkIn, checkOut, workHours } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /attendance/monthly - 월별 근태 기록
router.get('/monthly', authenticate, async (req: Request, res: Response) => {
  try {
    const year = parseInt(qs(req.query.year)) || new Date().getFullYear();
    const month = parseInt(qs(req.query.month)) || new Date().getMonth() + 1;
    const userId = qs(req.query.userId) || req.user!.id;

    // dept_admin 이상만 다른 사용자 조회 가능
    if (userId !== req.user!.id && !['super_admin', 'admin', 'dept_admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '권한이 없습니다' } });
      return;
    }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const records = await prisma.attendance.findMany({
      where: { userId, checkTime: { gte: start, lt: end } },
      orderBy: { checkTime: 'asc' },
    });

    res.json({ success: true, data: records });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 휴가 =====

const vacationSchema = z.object({
  type: z.enum(['annual', 'half_am', 'half_pm', 'sick', 'special', 'compensatory']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  days: z.number().min(0.5),
  reason: z.string().max(500).optional(),
});

// POST /attendance/vacations - 휴가 신청
router.post('/vacations', authenticate, validate(vacationSchema), async (req: Request, res: Response) => {
  try {
    // 잔여 연차 확인
    const year = new Date().getFullYear();
    const balance = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: req.user!.id, year } },
    });

    if (balance && req.body.type === 'annual' && balance.remainDays < req.body.days) {
      res.status(400).json({ success: false, error: { code: 'INSUFFICIENT_BALANCE', message: `잔여 연차가 부족합니다 (${balance.remainDays}일 남음)` } });
      return;
    }

    const vacation = await prisma.vacation.create({
      data: {
        userId: req.user!.id,
        type: req.body.type,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate),
        days: req.body.days,
        reason: req.body.reason,
      },
    });

    res.status(201).json({ success: true, data: vacation });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /attendance/vacations - 휴가 목록
router.get('/vacations', authenticate, async (req: Request, res: Response) => {
  try {
    const vacations = await prisma.vacation.findMany({
      where: { userId: req.user!.id },
      orderBy: { startDate: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: vacations });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /attendance/vacations/:id/approve - 휴가 승인 (관리자)
router.patch('/vacations/:id/approve', authenticate, authorize('super_admin', 'admin', 'dept_admin'), async (req: Request, res: Response) => {
  try {
    const vacation = await prisma.vacation.findUnique({ where: { id: qs(req.params.id) } });
    if (!vacation) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '휴가 신청을 찾을 수 없습니다' } }); return; }

    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.vacation.update({
        where: { id: qs(req.params.id) },
        data: { status: 'approved', approvedBy: req.user!.id, approvedAt: new Date() },
      });

      // 연차 차감
      if (v.type === 'annual' || v.type === 'half_am' || v.type === 'half_pm') {
        const year = v.startDate.getFullYear();
        await tx.vacationBalance.upsert({
          where: { userId_year: { userId: v.userId, year } },
          update: { usedDays: { increment: v.days }, remainDays: { decrement: v.days } },
          create: { userId: v.userId, year, totalDays: 15, usedDays: v.days, remainDays: 15 - v.days },
        });
      }

      return v;
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /attendance/balance - 연차 잔여
router.get('/balance', authenticate, async (req: Request, res: Response) => {
  try {
    const year = parseInt(qs(req.query.year)) || new Date().getFullYear();
    let balance = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: req.user!.id, year } },
    });

    if (!balance) {
      balance = await prisma.vacationBalance.create({
        data: { userId: req.user!.id, year, totalDays: 15, usedDays: 0, remainDays: 15 },
      });
    }

    res.json({ success: true, data: balance });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
