import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';

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
  scope: z.enum(['personal', 'department', 'company']).default('personal'),
  attendeeIds: z.array(z.string().uuid()).optional(),
});

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
        attendees: { include: { user: { select: { id: true, name: true } } } },
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    res.json({ success: true, data: events });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /calendar/events - 일정 생성
router.post('/events', authenticate, validate(eventSchema), async (req: Request, res: Response) => {
  try {
    const { attendeeIds, ...data } = req.body;

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
        attendees: { include: { user: { select: { id: true, name: true } } } },
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
  } catch {
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

    const { startDate, endDate, ...rest } = req.body;
    const updated = await prisma.calendarEvent.update({
      where: { id: qs(req.params.id) },
      data: {
        ...rest,
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
      },
    });

    // Google Calendar에 변경 반영 (creator의 연동이 있을 때)
    if (updated.scope === 'personal') {
      import('../services/google-calendar.service').then(({ pushEventToGoogle }) => {
        pushEventToGoogle(updated.creatorId, updated).catch(() => {});
      });
    }

    res.json({ success: true, data: updated });
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
