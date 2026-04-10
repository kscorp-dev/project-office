import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';

const router = Router();
router.use(checkModule('parking'));

// ===== 주차 구역 =====

const zoneSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().min(1).max(10),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
  totalSpots: z.number().int().min(0).default(0),
  cameraId: z.string().optional(),
});

router.get('/zones', authenticate, async (_req, res: Response) => {
  try {
    const zones = await prisma.parkingZone.findMany({
      where: { isActive: true },
      include: { lines: { where: { isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: zones });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/zones', authenticate, authorize('super_admin', 'admin'), validate(zoneSchema), async (req: Request, res: Response) => {
  try {
    const zone = await prisma.parkingZone.create({ data: req.body });
    res.status(201).json({ success: true, data: zone });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.patch('/zones/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const zone = await prisma.parkingZone.update({
      where: { id: qs(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: zone });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.delete('/zones/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    await prisma.parkingZone.update({
      where: { id: qs(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true, data: { message: '구역이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});


// ===== 입출차 라인 =====

const lineSchema = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['entry', 'exit', 'both']),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
});

router.post('/zones/:zoneId/lines', authenticate, authorize('super_admin', 'admin'), validate(lineSchema), async (req: Request, res: Response) => {
  try {
    const zone = await prisma.parkingZone.findUnique({ where: { id: qs(req.params.zoneId) } });
    if (!zone) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '구역을 찾을 수 없습니다' } }); return; }

    const line = await prisma.parkingLine.create({
      data: { ...req.body, zoneId: qs(req.params.zoneId) },
    });
    res.status(201).json({ success: true, data: line });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.delete('/lines/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    await prisma.parkingLine.update({
      where: { id: qs(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true, data: { message: '라인이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});


// ===== 입출차 이벤트 =====

router.get('/events', authenticate, async (req: Request, res: Response) => {
  try {
    const { type, zoneId, plateNumber, limit, offset } = req.query;
    const where: any = {};
    if (type) where.type = type;
    if (zoneId) where.zoneId = zoneId;
    if (plateNumber) where.plateNumber = { contains: plateNumber as string };

    const take = Math.min(Number(limit) || 50, 200);
    const skip = Number(offset) || 0;

    const [events, total] = await Promise.all([
      prisma.parkingEvent.findMany({
        where,
        include: { zone: { select: { id: true, name: true, label: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.parkingEvent.count({ where }),
    ]);

    res.json({ success: true, data: { events, total, limit: take, offset: skip } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// Webhook: detection 서버에서 호출 (인증 없이 — 내부 서비스 간 통신)
router.post('/events/webhook', async (req: Request, res: Response) => {
  try {
    const { type, plateNumber, trackId, cameraId, lineId, zoneId, direction } = req.body;
    if (!type || !['entry', 'exit'].includes(type)) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'type은 entry 또는 exit이어야 합니다' } });
      return;
    }

    const event = await prisma.parkingEvent.create({
      data: {
        type,
        plateNumber: plateNumber || null,
        trackId: trackId || null,
        cameraId: cameraId || null,
        lineId: lineId || null,
        zoneId: zoneId || null,
        direction: direction || null,
      },
    });
    res.status(201).json({ success: true, data: event });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// 통계
router.get('/events/stats', authenticate, async (_req, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayEntries, todayExits, totalZones] = await Promise.all([
      prisma.parkingEvent.count({ where: { type: 'entry', createdAt: { gte: today } } }),
      prisma.parkingEvent.count({ where: { type: 'exit', createdAt: { gte: today } } }),
      prisma.parkingZone.count({ where: { isActive: true } }),
    ]);

    const recentEvents = await prisma.parkingEvent.findMany({
      include: { zone: { select: { id: true, name: true, label: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({
      success: true,
      data: {
        todayEntries,
        todayExits,
        currentParked: todayEntries - todayExits,
        totalZones,
        recentEvents,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
