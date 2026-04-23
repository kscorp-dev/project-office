import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';
import { parsePagination, buildMeta } from '../utils/pagination';
import { recordAttendance } from '../services/attendance.service';
import { AppError } from '../services/auth.service';

const router = Router();
router.use(checkModule('attendance'));

// ===== 출퇴근 =====

const checkSchema = z.object({
  type: z.enum(['check_in', 'check_out']),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  note: z.string().max(200).optional(),
});

// POST /attendance/check - 출퇴근 기록 (service에서 advisory lock으로 동시성 방어)
router.post('/check', authenticate, validate(checkSchema), async (req: Request, res: Response) => {
  try {
    const attendance = await recordAttendance({
      userId: req.user!.id,
      type: req.body.type,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      note: req.body.note,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip,
      deviceType: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'web',
    });
    res.status(201).json({ success: true, data: attendance });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
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
  /** 결재선 (순서대로) — 전자결재 연동 (기획 §12) */
  approverIds: z.array(z.string().uuid()).min(1).max(10),
  referenceIds: z.array(z.string().uuid()).max(20).optional(),
});

// POST /attendance/vacations - 휴가 신청
// 전자결재와 자동 연동: Vacation(pending) + ApprovalDocument(pending) 동시 생성, 양방향 링크.
// 최종 승인 시 approval.service → applyVacationOnFinalApproval 이 호출되어
// VacationBalance 차감 + CalendarEvent 자동 등록 + 기안자 알림.
router.post('/vacations', authenticate, validate(vacationSchema), async (req: Request, res: Response) => {
  try {
    const { createVacationWithApproval } = await import('../services/vacation-approval.service');
    const result = await createVacationWithApproval({
      userId: req.user!.id,
      type: req.body.type,
      startDate: new Date(req.body.startDate),
      endDate: new Date(req.body.endDate),
      days: req.body.days,
      reason: req.body.reason,
      approverIds: req.body.approverIds,
      referenceIds: req.body.referenceIds,
    });

    // 첫 결재자 알림 발송 (실패해도 요청은 성공으로)
    const { ApprovalService } = await import('../services/approval.service');
    await new ApprovalService().notifyOnSubmit(result.approvalDocId).catch(() => {});

    res.status(201).json({ success: true, data: result });
  } catch (err: unknown) {
    // AppError 식별 (서비스에서 throw)
    if (err && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const e = err as { statusCode: number; code: string; message: string };
      res.status(e.statusCode).json({ success: false, error: { code: e.code, message: e.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /attendance/vacations - 휴가 목록 (페이지네이션)
router.get('/vacations', authenticate, async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 100 });
    const where = { userId: req.user!.id };

    const [vacations, total] = await Promise.all([
      prisma.vacation.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.vacation.count({ where }),
    ]);

    res.json({
      success: true,
      data: vacations,
      meta: buildMeta(pagination, total),
    });
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
