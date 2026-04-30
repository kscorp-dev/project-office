import { Router, Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { logger } from '../config/logger';
import { qs } from '../utils/query';
import { parsePagination, buildMeta } from '../utils/pagination';
import { config } from '../config';
import {
  getCameraAccessLevel,
  listAllowedCameraIds,
  type AccessUser,
} from '../services/cctv-permission.service';
import { executePtzCommand, testOnvifConnection, type PtzAction } from '../services/cctv-ptz.service';
import { encryptMailPassword } from '../utils/mailCrypto';
import {
  startStream,
  detachViewer,
  stopStream,
  listActiveStreams,
  touchStreamAccess,
  isFfmpegAvailable,
} from '../services/cctv-stream.service';

const router = Router();
router.use(checkModule('cctv'));

// 로그인 사용자 → AccessUser 변환 헬퍼
async function buildAccessUser(req: Request): Promise<AccessUser> {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, role: true, departmentId: true },
  });
  return {
    id: req.user!.id,
    role: u?.role ?? req.user!.role,
    departmentId: u?.departmentId ?? null,
  };
}

// ===== 카메라 그룹 =====

router.get('/groups', authenticate, async (req, res: Response) => {
  try {
    const groups = await prisma.cameraGroup.findMany({
      include: { cameras: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: groups });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/groups', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const group = await prisma.cameraGroup.create({ data: { name: req.body.name, sortOrder: req.body.sortOrder || 0 } });
    res.status(201).json({ success: true, data: group });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
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
  ptzAdapter: z.string().max(30).optional(),
  ptzUsername: z.string().max(100).optional(),
  ptzPassword: z.string().max(200).optional(),
  isPublic: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

// GET /cameras — 권한 있는 카메라만
router.get('/cameras', authenticate, async (req: Request, res: Response) => {
  try {
    const accessUser = await buildAccessUser(req);
    const allowed = await listAllowedCameraIds(accessUser);

    const where = allowed === 'all'
      ? { isActive: true }
      : { isActive: true, id: { in: allowed } };

    const cameras = await prisma.camera.findMany({
      where,
      include: { group: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    // ptzPassword는 응답에서 제거 (민감)
    const sanitized = cameras.map(({ ptzPassword, ...c }) => c);
    res.json({ success: true, data: sanitized });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.get('/cameras/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const accessUser = await buildAccessUser(req);
    const level = await getCameraAccessLevel(qs(req.params.id), accessUser);
    if (level === 'none') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '이 카메라에 접근 권한이 없습니다' } });
      return;
    }
    const camera = await prisma.camera.findUnique({
      where: { id: qs(req.params.id) },
      include: { group: true },
    });
    if (!camera) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카메라를 찾을 수 없습니다' } }); return; }
    const { ptzPassword, ...rest } = camera;
    res.json({ success: true, data: { ...rest, canControl: level === 'control' } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/cameras', authenticate, authorize('super_admin', 'admin'), validate(cameraSchema), async (req: Request, res: Response) => {
  try {
    const data = { ...req.body };
    // ptzPassword가 들어오면 AES-256-GCM 암호화해서 저장
    if (data.ptzPassword) {
      data.ptzPassword = encryptMailPassword(data.ptzPassword);
    }
    const camera = await prisma.camera.create({ data });
    const { ptzPassword, ...sanitized } = camera;
    res.status(201).json({ success: true, data: sanitized });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.patch('/cameras/:id', authenticate, authorize('super_admin', 'admin'), validate(cameraSchema.partial()), async (req: Request, res: Response) => {
  try {
    const data = { ...req.body };
    if (data.ptzPassword) {
      data.ptzPassword = encryptMailPassword(data.ptzPassword);
    } else if (data.ptzPassword === null || data.ptzPassword === '') {
      data.ptzPassword = null;
    }
    const camera = await prisma.camera.update({ where: { id: qs(req.params.id) }, data });
    const { ptzPassword, ...sanitized } = camera;
    res.json({ success: true, data: sanitized });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /cameras/:id/ptz/test — ONVIF 접속 테스트 (관리자)
router.post(
  '/cameras/:id/ptz/test',
  authenticate,
  authorize('super_admin', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const camera = await prisma.camera.findUnique({ where: { id: qs(req.params.id) } });
      if (!camera) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카메라를 찾을 수 없습니다' } });
        return;
      }
      if (!camera.isPtz) {
        res.status(400).json({ success: false, error: { code: 'NOT_PTZ', message: 'PTZ 지원하지 않는 카메라입니다' } });
        return;
      }
      const result = await testOnvifConnection(camera);
      if (!result.ok) {
        res.status(400).json({ success: false, error: { code: 'CONNECTION_FAILED', message: result.message } });
        return;
      }
      res.json({ success: true, data: { message: result.message } });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

router.delete('/cameras/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    await prisma.camera.update({ where: { id: qs(req.params.id) }, data: { isActive: false } });
    // 스트리밍 중이면 중지
    await stopStream(qs(req.params.id));
    res.json({ success: true, data: { message: '카메라가 비활성화되었습니다' } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 카메라 권한 (관리자) =====

const grantSchema = z.object({
  subjectType: z.enum(['user', 'department', 'role']),
  subjectId: z.string().min(1).max(100),
  level: z.enum(['view', 'control']).default('view'),
});

router.get(
  '/cameras/:id/permissions',
  authenticate,
  authorize('super_admin', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const rows = await prisma.cameraPermission.findMany({
        where: { cameraId: qs(req.params.id) },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: rows });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

router.post(
  '/cameras/:id/permissions',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(grantSchema),
  async (req: Request, res: Response) => {
    try {
      const perm = await prisma.cameraPermission.upsert({
        where: {
          cameraId_subjectType_subjectId: {
            cameraId: qs(req.params.id),
            subjectType: req.body.subjectType,
            subjectId: req.body.subjectId,
          },
        },
        update: { level: req.body.level },
        create: {
          cameraId: qs(req.params.id),
          subjectType: req.body.subjectType,
          subjectId: req.body.subjectId,
          level: req.body.level,
        },
      });
      res.status(201).json({ success: true, data: perm });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

router.delete(
  '/cameras/:id/permissions/:permId',
  authenticate,
  authorize('super_admin', 'admin'),
  async (req: Request, res: Response) => {
    try {
      await prisma.cameraPermission.delete({ where: { id: qs(req.params.permId) } });
      res.json({ success: true });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '권한을 찾을 수 없습니다' } });
    }
  },
);

// ===== PTZ 제어 (PTZ-001~005) =====

const ptzSchema = z.object({
  action: z.enum(['pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'zoom-in', 'zoom-out', 'stop', 'preset']),
  value: z.number().min(0).max(1).optional(),
  durationMs: z.number().int().min(0).max(30000).optional(),
});

router.post('/cameras/:id/ptz', authenticate, validate(ptzSchema), async (req: Request, res: Response) => {
  try {
    const accessUser = await buildAccessUser(req);
    const level = await getCameraAccessLevel(qs(req.params.id), accessUser);
    if (level !== 'control') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'PTZ 제어 권한이 없습니다' } });
      return;
    }
    const camera = await prisma.camera.findUnique({ where: { id: qs(req.params.id) } });
    if (!camera || !camera.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카메라를 찾을 수 없습니다' } });
      return;
    }

    const result = await executePtzCommand(camera, {
      action: req.body.action as PtzAction,
      value: req.body.value,
      durationMs: req.body.durationMs,
    });
    if (!result.ok) {
      res.status(400).json({ success: false, error: { code: 'PTZ_FAILED', message: result.message ?? 'PTZ 실패' } });
      return;
    }
    res.json({ success: true, data: { message: result.message ?? 'OK' } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 실시간 스트림 (LIVE-001) =====

// POST /cameras/:id/stream/start — HLS 변환 시작 + viewer 추가
router.post('/cameras/:id/stream/start', authenticate, async (req: Request, res: Response) => {
  try {
    const accessUser = await buildAccessUser(req);
    const level = await getCameraAccessLevel(qs(req.params.id), accessUser);
    if (level === 'none') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '이 카메라에 접근 권한이 없습니다' } });
      return;
    }
    const camera = await prisma.camera.findUnique({ where: { id: qs(req.params.id) } });
    if (!camera || !camera.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '카메라를 찾을 수 없습니다' } });
      return;
    }
    if (!isFfmpegAvailable()) {
      res.status(501).json({
        success: false,
        error: {
          code: 'FFMPEG_NOT_CONFIGURED',
          message: '서버에 FFmpeg가 설정되지 않아 실시간 스트리밍을 사용할 수 없습니다. 관리자에게 문의하세요.',
        },
      });
      return;
    }

    const result = await startStream({
      cameraId: camera.id,
      rtspUrl: camera.rtspUrl,
      viewerId: req.user!.id,
    });
    if (!result.ok) {
      const status = result.reason === 'MAX_VIEWERS_REACHED' ? 429 : 500;
      res.status(status).json({
        success: false,
        error: {
          code: result.reason,
          message:
            result.reason === 'MAX_VIEWERS_REACHED'
              ? '동시 시청자가 너무 많습니다 (최대 20명)'
              : result.reason,
        },
      });
      return;
    }
    res.json({
      success: true,
      data: {
        playlistUrl: `/api/cctv/cameras/${camera.id}/stream/playlist.m3u8`,
        viewerCount: result.viewerCount,
      },
    });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /cameras/:id/stream/stop — viewer 제거 (0명이면 idle 타이머로 종료)
router.post('/cameras/:id/stream/stop', authenticate, async (req: Request, res: Response) => {
  try {
    detachViewer(qs(req.params.id), req.user!.id);
    res.json({ success: true });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /cameras/:id/stream/playlist.m3u8 또는 /stream/segN.ts
// HLS 플레이어가 자동 요청 — lastAccessAt 갱신
router.get('/cameras/:id/stream/:file', authenticate, async (req: Request, res: Response) => {
  try {
    const cameraId = qs(req.params.id);
    const file = qs(req.params.file);

    // 권한 재체크
    const accessUser = await buildAccessUser(req);
    const level = await getCameraAccessLevel(cameraId, accessUser);
    if (level === 'none') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '권한 없음' } });
      return;
    }

    // 파일명 검증 — playlist.m3u8 또는 seg####.ts만
    if (!/^(index\.m3u8|playlist\.m3u8|seg\d{4}\.ts)$/.test(file)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_FILE', message: '잘못된 파일명' } });
      return;
    }

    const realFile = file === 'playlist.m3u8' ? 'index.m3u8' : file;
    const absPath = path.resolve(config.upload.dir, 'cctv-streams', cameraId, realFile);
    const baseDir = path.resolve(config.upload.dir, 'cctv-streams');
    if (!absPath.startsWith(baseDir) || !fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '스트림 파일이 없습니다. 먼저 start를 호출하세요.' } });
      return;
    }

    touchStreamAccess(cameraId);

    res.setHeader(
      'Content-Type',
      realFile.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(absPath);
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /streams/active (관리자) — 현재 실행 중인 스트림 목록
router.get('/streams/active', authenticate, authorize('super_admin', 'admin'), (_req: Request, res: Response) => {
  res.json({ success: true, data: listActiveStreams() });
});

// ===== 녹화 =====

router.get('/cameras/:id/recordings', authenticate, async (req: Request, res: Response) => {
  try {
    const cameraId = qs(req.params.id);
    const accessUser = await buildAccessUser(req);
    const level = await getCameraAccessLevel(cameraId, accessUser);
    if (level === 'none') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '이 카메라에 접근 권한이 없습니다' } });
      return;
    }

    const { startDate, endDate } = req.query;
    const where: any = { cameraId };
    if (startDate) where.startTime = { gte: new Date(startDate as string) };
    if (endDate) where.endTime = { ...(where.endTime || {}), lte: new Date(endDate as string) };

    const pagination = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 50, maxLimit: 200 });
    const [recordings, total] = await Promise.all([
      prisma.recording.findMany({
        where,
        orderBy: { startTime: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.recording.count({ where }),
    ]);
    res.json({ success: true, data: recordings, meta: buildMeta(pagination, total) });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
