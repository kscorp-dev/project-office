import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';
import { logger } from '../config/logger';

const router = Router();
router.use(checkModule('calendar'));

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  color: z.string().max(7).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).default('none'),
  repeatUntil: z.string().datetime().optional().nullable(),
  exceptionDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  scope: z.enum(['personal', 'department', 'company']).default('personal'),
  attendeeIds: z.array(z.string().uuid()).max(200).optional(),
}).refine(
  (d) => new Date(d.endDate) >= new Date(d.startDate),
  { message: '종료 시각은 시작 시각보다 같거나 이후여야 합니다', path: ['endDate'] },
).refine(
  (d) => !d.repeatUntil || new Date(d.repeatUntil) >= new Date(d.startDate),
  { message: '반복 종료일은 시작일보다 같거나 이후여야 합니다', path: ['repeatUntil'] },
);

// GET /calendar/events - 일정 조회
router.get('/events', authenticate, async (req: Request, res: Response) => {
  try {
    const start = req.query.start ? new Date(qs(req.query.start)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = req.query.end ? new Date(qs(req.query.end)) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

    const events = await prisma.calendarEvent.findMany({
      where: {
        isActive: true,
        OR: [
          { creatorId: req.user!.id }, // 내 일정
          { scope: 'company' }, // 회사 전체
          { scope: 'department', departmentId: req.user!.departmentId || undefined }, // 내 부서
          { attendees: { some: { userId: req.user!.id } } }, // 초대된 일정
        ],
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: {
        creator: { select: { id: true, name: true } },
        attendees: {
          include: { user: { select: { id: true, name: true } } },
        },
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: { startDate: 'asc' },
      take: 2000, // 한 번 query 에 안전 상한 — 큰 범위는 클라이언트가 분할 조회
    });

    res.json({ success: true, data: events });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /calendar/events - 일정 생성
router.post('/events', authenticate, validate(eventSchema), async (req: Request, res: Response) => {
  try {
    const { attendeeIds, ...data } = req.body;

    // 회사 전사/부서 일정 생성은 관리자만 (일반 사용자가 임의로 회사 캘린더 spam 차단)
    const isAdmin = ['super_admin', 'admin'].includes(req.user!.role);
    const isDeptAdmin = req.user!.role === 'dept_admin';
    if (data.scope === 'company' && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '전사 일정은 관리자만 등록할 수 있습니다' } });
      return;
    }
    if (data.scope === 'department' && !isAdmin && !isDeptAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '부서 일정은 부서/전체 관리자만 등록할 수 있습니다' } });
      return;
    }

    const event = await prisma.calendarEvent.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        creatorId: req.user!.id,
        departmentId: data.scope === 'department' ? req.user!.departmentId : undefined,
        attendees: attendeeIds ? {
          create: attendeeIds.map((userId: string) => ({ userId })),
        } : undefined,
      },
      include: {
        creator: { select: { id: true, name: true } },
        attendees: {
          include: { user: { select: { id: true, name: true } } },
        },
        category: { select: { id: true, name: true, color: true } },
      },
    });

    // Google Calendar로 push sync (비동기, 실패해도 응답 정상)
    if (event.scope === 'personal') {
      import('../services/google-calendar.service').then(({ pushEventToGoogle }) => {
        pushEventToGoogle(req.user!.id, event).catch(() => {});
      });
    }

    res.status(201).json({ success: true, data: event });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /calendar/events/:id - 일정 수정
router.patch('/events/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const event = await prisma.calendarEvent.findUnique({ where: { id: qs(req.params.id) } });
    if (!event) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다' } }); return; }
    if (event.creatorId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } }); return;
    }

    // mass assignment 방지 — 화이트리스트 명시 (id/creatorId/createdAt 등 변경 불가)
    const {
      title, description, location, color, categoryId, allDay, scope, departmentId,
      repeat, exceptionDates,
      startDate, endDate, attendeeIds, repeatUntil,
    } = req.body as Record<string, unknown>;

    // 시간 검증 — POST 와 동일하게 PATCH 도 startDate/endDate/repeatUntil 일관성 검사 (11차 H1)
    const finalStart = startDate ? new Date(startDate as string) : event.startDate;
    const finalEnd = endDate ? new Date(endDate as string) : event.endDate;
    if (finalEnd < finalStart) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATE_RANGE', message: '종료 시각은 시작 시각보다 같거나 이후여야 합니다' },
      });
      return;
    }
    if (repeatUntil) {
      const ru = new Date(repeatUntil as string);
      if (ru < finalStart) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_REPEAT_UNTIL', message: '반복 종료일은 시작일보다 같거나 이후여야 합니다' },
        });
        return;
      }
    }

    // scope 격상은 관리자만 (일반 사용자가 personal → company 변경 차단)
    const isAdmin = ['super_admin', 'admin'].includes(req.user!.role);
    const isDeptAdmin = req.user!.role === 'dept_admin';
    if (scope !== undefined && scope !== event.scope) {
      if (scope === 'company' && !isAdmin) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '전사 일정 격상은 관리자만 가능합니다' } });
        return;
      }
      if (scope === 'department' && !isAdmin && !isDeptAdmin) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '부서 일정 격상은 부서/전체 관리자만 가능합니다' } });
        return;
      }
    }
    // departmentId 변경도 admin/dept_admin 만 (5차 감사 H2 — 본인 부서 → 타 부서 reassign 차단)
    if (departmentId !== undefined && departmentId !== event.departmentId && !isAdmin && !isDeptAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: '소속 부서 변경은 관리자만 가능합니다' },
      });
      return;
    }

    // attendeeIds가 들어오면 기존 참석자 전체 교체
    if (attendeeIds !== undefined && Array.isArray(attendeeIds)) {
      await prisma.eventAttendee.deleteMany({ where: { eventId: qs(req.params.id) } });
      if (attendeeIds.length > 0) {
        await prisma.eventAttendee.createMany({
          data: (attendeeIds as string[]).map((userId: string) => ({ eventId: qs(req.params.id), userId })),
        });
      }
    }

    const updated = await prisma.calendarEvent.update({
      where: { id: qs(req.params.id) },
      data: {
        ...(title !== undefined ? { title: title as string } : {}),
        ...(description !== undefined ? { description: description as string | null } : {}),
        ...(location !== undefined ? { location: location as string | null } : {}),
        ...(color !== undefined ? { color: color as string | null } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId as string | null } : {}),
        ...(allDay !== undefined ? { allDay: !!allDay } : {}),
        ...(scope !== undefined ? { scope: scope as string } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId as string | null } : {}),
        ...(repeat !== undefined ? { repeat: repeat as any } : {}),
        ...(exceptionDates !== undefined ? { exceptionDates: exceptionDates as string[] } : {}),
        ...(startDate ? { startDate: new Date(startDate as string) } : {}),
        ...(endDate ? { endDate: new Date(endDate as string) } : {}),
        ...(repeatUntil !== undefined
          ? { repeatUntil: repeatUntil ? new Date(repeatUntil as string) : null }
          : {}),
      },
    });

    // Google Calendar에 변경 반영 (creator의 연동이 있을 때)
    if (updated.scope === 'personal') {
      import('../services/google-calendar.service').then(({ pushEventToGoogle }) => {
        pushEventToGoogle(updated.creatorId, updated).catch(() => {});
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /calendar/events/:id
router.delete('/events/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const event = await prisma.calendarEvent.findUnique({ where: { id: qs(req.params.id) } });
    if (!event) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다' } }); return; }
    if (event.creatorId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } }); return;
    }

    await prisma.calendarEvent.update({ where: { id: qs(req.params.id) }, data: { isActive: false } });

    // Google에서도 삭제
    import('../services/google-calendar.service').then(({ deleteEventOnGoogle }) => {
      deleteEventOnGoogle(event.creatorId, event.id).catch(() => {});
    });

    res.json({ success: true, data: { message: '일정이 삭제되었습니다' } });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ───── 반복 이벤트의 특정 인스턴스 삭제 (v0.21.0) ─────
// POST /events/:id/exception { date: 'YYYY-MM-DD' }
// → exceptionDates 배열에 date 추가 → 클라이언트 expand 시 제외됨
router.post(
  '/events/:id/exception',
  authenticate,
  validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (req: Request, res: Response) => {
    try {
      const event = await prisma.calendarEvent.findUnique({ where: { id: qs(req.params.id) } });
      if (!event) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다' } });
        return;
      }
      if (event.creatorId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '권한이 없습니다' } });
        return;
      }
      if (event.repeat === 'none') {
        res.status(400).json({ success: false, error: { code: 'NOT_REPEATING', message: '반복 이벤트가 아닙니다' } });
        return;
      }
      const date = req.body.date as string;
      const next = Array.from(new Set([...(event.exceptionDates || []), date]));
      const updated = await prisma.calendarEvent.update({
        where: { id: event.id },
        data: { exceptionDates: next },
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      logger.warn({ err }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// ───── 참석자 응답 (수락/거절) ─────
// PATCH /events/:id/attendance { status: 'accepted' | 'declined' | 'pending' }
// → 본인의 EventAttendee.status 업데이트. 참석자가 아니면 자동 추가
router.patch(
  '/events/:id/attendance',
  authenticate,
  validate(z.object({ status: z.enum(['accepted', 'declined', 'pending']) })),
  async (req: Request, res: Response) => {
    try {
      const eventId = qs(req.params.id);
      const userId = req.user!.id;
      const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다' } });
        return;
      }

      const existing = await prisma.eventAttendee.findUnique({
        where: { eventId_userId: { eventId, userId } },
      });

      if (existing) {
        await prisma.eventAttendee.update({
          where: { id: existing.id },
          data: { status: req.body.status },
        });
      } else {
        await prisma.eventAttendee.create({
          data: { eventId, userId, status: req.body.status },
        });
      }
      res.json({ success: true });
    } catch (err) {
      logger.warn({ err }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

/* ═══════════════════════════════════════════════
   캘린더 카테고리 (v0.20.0)
   ═══════════════════════════════════════════════
   - GET  /categories  : 전역 + 본인 카테고리 조회
   - POST /categories  : 개인 카테고리 생성
   - PATCH /:id        : 이름/색상 변경 (본인 것 or 관리자)
   - DELETE /:id       : 삭제 (isDefault 금지, 본인 것 or 관리자)
*/

const categorySchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB 형식이어야 합니다'),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

// GET /calendar/categories
router.get('/categories', authenticate, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.calendarCategory.findMany({
      where: {
        OR: [
          { ownerId: null },         // 전역
          { ownerId: req.user!.id }, // 내 것
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /calendar/categories (개인 카테고리 생성)
router.post('/categories', authenticate, validate(categorySchema), async (req: Request, res: Response) => {
  try {
    const created = await prisma.calendarCategory.create({
      data: {
        name: req.body.name,
        color: req.body.color,
        sortOrder: req.body.sortOrder ?? 0,
        ownerId: req.user!.id,
        isDefault: false,
      },
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /calendar/categories/:id
router.patch('/categories/:id', authenticate, validate(categorySchema.partial()), async (req: Request, res: Response) => {
  try {
    const cat = await prisma.calendarCategory.findUnique({ where: { id: qs(req.params.id) } });
    if (!cat) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카테고리를 찾을 수 없습니다' } });
      return;
    }
    // 권한: 전역 카테고리는 관리자만, 개인 카테고리는 소유자만
    const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
    if (cat.ownerId === null && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '기본 카테고리는 관리자만 수정할 수 있습니다' } });
      return;
    }
    if (cat.ownerId !== null && cat.ownerId !== req.user!.id && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '본인 카테고리만 수정할 수 있습니다' } });
      return;
    }

    const updated = await prisma.calendarCategory.update({
      where: { id: cat.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.color !== undefined ? { color: req.body.color } : {}),
        ...(req.body.sortOrder !== undefined ? { sortOrder: req.body.sortOrder } : {}),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /calendar/categories/:id (isDefault=true는 삭제 불가)
router.delete('/categories/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const cat = await prisma.calendarCategory.findUnique({ where: { id: qs(req.params.id) } });
    if (!cat) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카테고리를 찾을 수 없습니다' } });
      return;
    }
    if (cat.isDefault) {
      res.status(400).json({ success: false, error: { code: 'DEFAULT_CATEGORY', message: '기본 카테고리는 삭제할 수 없습니다' } });
      return;
    }
    const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
    if (cat.ownerId !== req.user!.id && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '본인 카테고리만 삭제할 수 있습니다' } });
      return;
    }

    // 이 카테고리를 사용하는 이벤트들은 categoryId=null로 자동 (onDelete: SetNull)
    await prisma.calendarCategory.delete({ where: { id: cat.id } });
    res.json({ success: true });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
