import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';

const router = Router();
router.use(checkModule('cctv'));

// ===== 카메라 그룹 =====

router.get('/groups', authenticate, async (_req, res: Response) => {
  try {
    const groups = await prisma.cameraGroup.findMany({
      include: { cameras: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: groups });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/groups', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const group = await prisma.cameraGroup.create({ data: { name: req.body.name, sortOrder: req.body.sortOrder || 0 } });
    res.status(201).json({ success: true, data: group });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 카메라 =====

const cameraSchema = z.object({
  name: z.string().min(1).max(100),
  rtspUrl: z.string().min(1),
  location: z.string().max(200).optional(),
  groupId: z.string().uuid().optional(),
  isPtz: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

router.get('/cameras', authenticate, async (_req, res: Response) => {
  try {
    const cameras = await prisma.camera.findMany({
      where: { isActive: true },
      include: { group: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: cameras });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.get('/cameras/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.findUnique({
      where: { id: req.params.id },
      include: { group: true },
    });
    if (!camera) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카메라를 찾을 수 없습니다' } }); return; }
    res.json({ success: true, data: camera });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/cameras', authenticate, authorize('super_admin', 'admin'), validate(cameraSchema), async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.create({ data: req.body });
    res.status(201).json({ success: true, data: camera });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.patch('/cameras/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.update({ where: { id: req.params.id }, data: req.body });
    res.json({ success: true, data: camera });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.delete('/cameras/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    await prisma.camera.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, data: { message: '카메라가 비활성화되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 녹화 =====

router.get('/cameras/:id/recordings', authenticate, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const where: any = { cameraId: req.params.id };
    if (startDate) where.startTime = { gte: new Date(startDate as string) };
    if (endDate) where.endTime = { ...(where.endTime || {}), lte: new Date(endDate as string) };

    const recordings = await prisma.recording.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: recordings });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
