/**
 * 공휴일 관리 + 연차 자동부여 수동 실행 API
 *
 * 공휴일:
 *   - GET /holidays?year=2026 — 일반 사용자도 조회 가능 (캘린더 표시용)
 *   - POST /holidays (admin) — 신규 등록
 *   - PATCH /holidays/:id (admin)
 *   - DELETE /holidays/:id (admin)
 *   - POST /holidays/bulk-import (admin) — JSON 배열 일괄 등록
 *
 * 연차 자동부여 (관리자):
 *   - POST /holidays/accrual/annual  { year, force? } — 특정 연도 전체 직원 부여
 *   - POST /holidays/accrual/monthly — 오늘 기준 근속 1년 미만 직원 월차
 *   - POST /holidays/accrual/user/:userId { year, force? } — 단일 사용자 재계산
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { qs } from '../utils/query';
import {
  grantAnnualLeaveForUser,
  grantMonthlyLeaveForUser,
  runAnnualAccrualBatch,
  runMonthlyAccrualBatch,
} from '../services/vacation-accrual.service';

const router = Router();

// ===== 공휴일 CRUD =====

// GET /holidays?year=2026 - 연도별 공휴일 목록 (로그인 사용자 누구나)
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const year = parseInt(qs(req.query.year)) || new Date().getFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

    const rows = await prisma.holiday.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });
    res.json({ success: true, data: rows });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다'),
  name: z.string().min(1).max(100),
  type: z.enum(['legal', 'substitute', 'company', 'event']).default('legal'),
  excludeFromWorkdays: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

// POST /holidays - 공휴일 등록 (관리자)
router.post(
  '/',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(holidaySchema),
  async (req: Request, res: Response) => {
    try {
      const excludeFromWorkdays =
        typeof req.body.excludeFromWorkdays === 'boolean'
          ? req.body.excludeFromWorkdays
          : req.body.type !== 'event';
      const holiday = await prisma.holiday.create({
        data: {
          date: new Date(`${req.body.date}T00:00:00Z`),
          name: req.body.name,
          type: req.body.type,
          excludeFromWorkdays,
          note: req.body.note,
        },
      });
      res.status(201).json({ success: true, data: holiday });
    } catch (err: unknown) {
      // unique violation
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE', message: '같은 날짜/이름의 공휴일이 이미 등록되어 있습니다' },
        });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// PATCH /holidays/:id (관리자)
router.patch(
  '/:id',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(holidaySchema.partial()),
  async (req: Request, res: Response) => {
    try {
      const data: Record<string, unknown> = {};
      if (req.body.date) data.date = new Date(`${req.body.date}T00:00:00Z`);
      if (req.body.name) data.name = req.body.name;
      if (req.body.type) data.type = req.body.type;
      if (req.body.excludeFromWorkdays !== undefined) data.excludeFromWorkdays = req.body.excludeFromWorkdays;
      if (req.body.note !== undefined) data.note = req.body.note;

      const holiday = await prisma.holiday.update({
        where: { id: qs(req.params.id) },
        data,
      });
      res.json({ success: true, data: holiday });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '공휴일을 찾을 수 없습니다' } });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// DELETE /holidays/:id (관리자)
router.delete(
  '/:id',
  authenticate,
  authorize('super_admin', 'admin'),
  async (req: Request, res: Response) => {
    try {
      await prisma.holiday.delete({ where: { id: qs(req.params.id) } });
      res.json({ success: true });
    } catch {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '공휴일을 찾을 수 없습니다' } });
    }
  },
);

// POST /holidays/bulk-import (관리자) — 예: 매년 행안부 공휴일 데이터 일괄 입력
const bulkSchema = z.object({
  items: z.array(holidaySchema).min(1).max(200),
  skipDuplicates: z.boolean().default(true),
});

router.post(
  '/bulk-import',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(bulkSchema),
  async (req: Request, res: Response) => {
    try {
      const data = req.body.items.map((it: z.infer<typeof holidaySchema>) => ({
        date: new Date(`${it.date}T00:00:00Z`),
        name: it.name,
        type: it.type,
        excludeFromWorkdays:
          typeof it.excludeFromWorkdays === 'boolean' ? it.excludeFromWorkdays : it.type !== 'event',
        note: it.note,
      }));
      const result = await prisma.holiday.createMany({
        data,
        skipDuplicates: req.body.skipDuplicates,
      });
      res.json({ success: true, data: { inserted: result.count } });
    } catch {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// ===== 연차 자동부여 수동 실행 =====

// POST /holidays/accrual/annual (super_admin/admin)
router.post(
  '/accrual/annual',
  authenticate,
  authorize('super_admin', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const year = parseInt(qs(req.body.year)) || new Date().getFullYear();
      const force = !!req.body.force;
      const result = await runAnnualAccrualBatch(year, { force });
      res.json({ success: true, data: result });
    } catch {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// POST /holidays/accrual/monthly (admin) — 오늘 기준 근속 1년 미만 월차 부여
router.post(
  '/accrual/monthly',
  authenticate,
  authorize('super_admin', 'admin'),
  async (_req: Request, res: Response) => {
    try {
      const result = await runMonthlyAccrualBatch(new Date());
      res.json({ success: true, data: result });
    } catch {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// POST /holidays/accrual/user/:userId (admin) — 단일 사용자 재계산
router.post(
  '/accrual/user/:userId',
  authenticate,
  authorize('super_admin', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const year = parseInt(qs(req.body.year)) || new Date().getFullYear();
      const force = !!req.body.force;
      const result = await grantAnnualLeaveForUser(qs(req.params.userId), year, { force });
      if (!result.ok) {
        res.status(400).json({ success: false, error: { code: result.reason, message: result.reason } });
        return;
      }
      res.json({ success: true, data: result });
    } catch {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

export default router;
