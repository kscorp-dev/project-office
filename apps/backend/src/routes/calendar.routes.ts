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
      },
    });

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
    res.json({ success: true, data: { message: '일정이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
