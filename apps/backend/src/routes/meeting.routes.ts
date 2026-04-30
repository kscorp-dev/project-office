import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { config } from '../config';
import { qs, qsOpt } from '../utils/query';
import { meetingFileFilter } from '../utils/fileFilter';
import { canViewMeeting, canJoinMeeting } from '../services/meeting.service';
import { logger } from '../config/logger';
import { createNotification } from '../services/notification.service';
import {
  generateMinutes,
  updateMinutes,
  finalizeMinutes,
} from '../services/minutes.service';

const router = Router();
router.use(checkModule('meeting'));

// ===== 회의 =====

const meetingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime(),
  maxParticipants: z.number().int().min(2).max(16).optional(),
  password: z.string().max(50).optional(),
  participantIds: z.array(z.string().uuid()).optional(),
});

function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /meeting - 회의 목록 (내가 호스트 + 초대된 회의, 페이지네이션)
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const status = qs(req.query.status);

    const where: any = {
      OR: [
        { hostId: req.user!.id },
        { participants: { some: { userId: req.user!.id } } },
      ],
    };
    if (status) {
      where.status = status;
    }

    const [meetings, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        include: {
          host: { select: { id: true, name: true, position: true } },
          _count: { select: { participants: true } },
        },
        orderBy: { scheduledAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.meeting.count({ where }),
    ]);

    res.json({ success: true, data: meetings, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /meeting/:id - 회의 상세
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: qs(req.params.id) },
      include: {
        host: { select: { id: true, name: true, position: true } },
        participants: {
          include: { user: { select: { id: true, name: true, position: true } } },
        },
      },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }

    // 호스트이거나 참여자인 경우만 상세 조회 가능
    const isParticipant = meeting.participants.some(p => p.userId === req.user!.id);
    if (meeting.hostId !== req.user!.id && !isParticipant && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' } });
      return;
    }

    res.json({ success: true, data: meeting });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting - 회의 생성
router.post('/', authenticate, validate(meetingSchema), async (req: Request, res: Response) => {
  try {
    const { participantIds, ...data } = req.body;

    // 고유 roomCode 생성
    let roomCode: string;
    let codeExists = true;
    do {
      roomCode = generateRoomCode();
      const existing = await prisma.meeting.findFirst({ where: { roomCode } });
      codeExists = !!existing;
    } while (codeExists);

    const meeting = await prisma.meeting.create({
      data: {
        ...data,
        scheduledAt: new Date(data.scheduledAt),
        hostId: req.user!.id,
        roomCode,
        status: 'scheduled',
        participants: {
          create: [
            { userId: req.user!.id, role: 'host' },
            ...(participantIds ? participantIds.map((userId: string) => ({ userId, role: 'participant' })) : []),
          ],
        },
      },
      include: {
        host: { select: { id: true, name: true, position: true } },
        participants: {
          include: { user: { select: { id: true, name: true, position: true } } },
        },
      },
    });

    // 참가자에게 회의 초대 알림 (호스트 본인 제외)
    // 모바일은 mapToMobilePayload 에서 mobileType='meeting' + id=meetingId 로 받음
    // → displayIncomingMeetingCall 트리거 가능 (CallKit/ConnectionService)
    const startsAt = new Date(data.scheduledAt);
    const startsLabel = startsAt.toLocaleString('ko-KR', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const inviteeIds = (participantIds ?? []) as string[];
    await Promise.allSettled(
      inviteeIds
        .filter((uid) => uid !== req.user!.id)
        .map((uid) =>
          createNotification({
            recipientId: uid,
            actorId: req.user!.id,
            type: 'meeting_invited',
            title: `회의 초대: ${meeting.title}`,
            body: `${meeting.host.name}님이 회의에 초대했습니다 · ${startsLabel}`,
            link: `/meeting/${meeting.id}`,
            refType: 'meeting',
            refId: meeting.id,
            meta: {
              roomCode: meeting.roomCode,
              scheduledAt: data.scheduledAt,
              hostName: meeting.host.name,
            },
          }),
        ),
    );

    res.status(201).json({ success: true, data: meeting });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/ring - 호스트가 즉시 시작하면 참가자에게 "수신 통화" 알림 발사
// (모바일에서 CallKit / ConnectionService UI 트리거 — VoIP push 가 아닌 high-priority FCM/APNs 로 동작)
router.post('/:id/ring', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: qs(req.params.id) },
      include: {
        host: { select: { id: true, name: true } },
        participants: { select: { userId: true } },
      },
    });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    if (meeting.hostId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트만 호출할 수 있습니다' } });
      return;
    }

    const targets = meeting.participants
      .map((p) => p.userId)
      .filter((uid) => uid !== req.user!.id);

    await Promise.allSettled(
      targets.map((uid) =>
        createNotification({
          recipientId: uid,
          actorId: req.user!.id,
          type: 'meeting_invited',
          title: `📞 ${meeting.host.name}님의 통화 호출`,
          body: meeting.title,
          link: `/meeting/${meeting.id}`,
          refType: 'meeting',
          refId: meeting.id,
          meta: { ring: true, roomCode: meeting.roomCode, hostName: meeting.host.name },
        }),
      ),
    );

    res.json({ success: true, data: { ringedCount: targets.length } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/decline - 참가자가 통화 호출(ring)에 거절. 호스트에게 거절 알림.
router.post('/:id/decline', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: qs(req.params.id) },
      select: {
        id: true, title: true, hostId: true,
        participants: { select: { userId: true } },
      },
    });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    // 권한 검증 — 회의 참가자 또는 호스트만 decline 가능 (외부인이 호스트 스팸하는 것 차단)
    const isHost = meeting.hostId === req.user!.id;
    const isParticipant = meeting.participants.some((p) => p.userId === req.user!.id);
    if (!isHost && !isParticipant) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '회의 참가자만 거절할 수 있습니다' } });
      return;
    }
    // 호스트에게 1회성 거절 알림 (조용히 — 토스트 수준)
    if (!isHost) {
      const decliner = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });
      await createNotification({
        recipientId: meeting.hostId,
        actorId: req.user!.id,
        type: 'meeting_invited',
        title: '통화 거절',
        body: `${decliner?.name ?? '참가자'}님이 ${meeting.title} 호출을 거절했습니다`,
        link: `/meeting/${meeting.id}`,
        refType: 'meeting',
        refId: meeting.id,
        meta: { declined: true },
      }).catch(() => { /* 호스트 알림 실패해도 응답은 OK */ });
    }
    res.json({ success: true });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /meeting/:id - 회의 수정 (호스트만)
router.patch('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: qs(req.params.id) } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    if (meeting.hostId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트만 수정할 수 있습니다' } });
      return;
    }
    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '종료되거나 취소된 회의는 수정할 수 없습니다' } });
      return;
    }

    const { scheduledAt, participantIds, ...rest } = req.body;
    const updated = await prisma.meeting.update({
      where: { id: qs(req.params.id) },
      data: {
        ...rest,
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/start - 회의 시작 (호스트만)
router.post('/:id/start', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: qs(req.params.id) } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    if (meeting.hostId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트만 회의를 시작할 수 있습니다' } });
      return;
    }
    if (meeting.status !== 'scheduled') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '예약된 회의만 시작할 수 있습니다' } });
      return;
    }

    const updated = await prisma.meeting.update({
      where: { id: qs(req.params.id) },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/end - 회의 종료 (호스트만)
router.post('/:id/end', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: qs(req.params.id) } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    if (meeting.hostId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트만 회의를 종료할 수 있습니다' } });
      return;
    }
    if (meeting.status !== 'in_progress') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '진행 중인 회의만 종료할 수 있습니다' } });
      return;
    }

    const updated = await prisma.meeting.update({
      where: { id: qs(req.params.id) },
      data: { status: 'ended', endedAt: new Date() },
    });

    // 비동기 회의록 생성 트리거 (응답 차단 안 함)
    // - 결과는 GET /:id/minutes로 조회
    // - 실패/키 미설정은 MeetingMinutes.status=failed + errorMessage에 기록
    generateMinutes(updated.id).catch((e) => {
      console.warn('[Meeting] minutes generation failed:', (e as Error).message);
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/cancel - 회의 취소 (호스트만)
router.post('/:id/cancel', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: qs(req.params.id) } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    if (meeting.hostId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트만 회의를 취소할 수 있습니다' } });
      return;
    }
    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '이미 종료되거나 취소된 회의입니다' } });
      return;
    }
    await prisma.meeting.update({ where: { id: qs(req.params.id) }, data: { status: 'cancelled' } });
    res.json({ success: true, data: { message: '회의가 취소되었습니다' } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /meeting/:id - 회의 취소 (호스트만)
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: qs(req.params.id) } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    if (meeting.hostId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트만 회의를 취소할 수 있습니다' } });
      return;
    }
    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '이미 종료되거나 취소된 회의입니다' } });
      return;
    }

    await prisma.meeting.update({ where: { id: qs(req.params.id) }, data: { status: 'cancelled' } });
    res.json({ success: true, data: { message: '회의가 취소되었습니다' } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /meeting/:id/join - 참여 정보 확인 (초대 여부 확인)
router.get('/:id/join', authenticate, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: qs(req.params.id) },
      include: {
        host: { select: { id: true, name: true } },
        participants: { select: { userId: true, role: true } },
      },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }

    const isHost = meeting.hostId === req.user!.id;
    const participantRecord = meeting.participants.find(p => p.userId === req.user!.id);
    const isInvited = !!participantRecord;

    if (!isHost && !isInvited) {
      res.status(403).json({ success: false, error: { code: 'NOT_INVITED', message: '초대받지 않은 회의입니다' } });
      return;
    }

    res.json({
      success: true,
      data: {
        meetingId: meeting.id,
        roomCode: meeting.roomCode,
        status: meeting.status,
        isHost,
        role: isHost ? 'host' : participantRecord!.role,
        requiresPassword: !!meeting.password,
      },
    });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 회의 문서 공유 =====

/** 공유 문서 메타 타입 */
interface SharedDocMeta {
  id: string;
  fileName: string;
  storedName: string;
  fileSize: number;
  mimeType: string;
  sharedBy: string;
  sharedById: string;
  sharedAt: string;
}

/** multer 저장소 설정 — uploads/meetings/{meetingId}/ */
const meetingStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const meetingId = qs(req.params.id);
    const dir = path.resolve(config.upload.dir, 'meetings', meetingId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const meetingUpload = multer({
  storage: meetingStorage,
  limits: { fileSize: config.upload.maxFileSize },
  // 확장자 + MIME 타입 교차 검증
  fileFilter: meetingFileFilter,
});

/** 메타데이터 JSON 읽기/쓰기 헬퍼 */
function metaPath(meetingId: string) {
  return path.resolve(config.upload.dir, 'meetings', meetingId, '_metadata.json');
}
function readMeta(meetingId: string): SharedDocMeta[] {
  const p = metaPath(meetingId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
}
function writeMeta(meetingId: string, data: SharedDocMeta[]) {
  const dir = path.resolve(config.upload.dir, 'meetings', meetingId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(meetingId), JSON.stringify(data, null, 2));
}

// POST /meeting/:id/documents — 문서 업로드 (참가자/호스트/관리자만)
router.post('/:id/documents', authenticate, meetingUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '파일이 첨부되지 않았습니다' } });
      return;
    }

    // 권한 검증 — 회의 참여 권한이 있는 사람만 업로드 가능
    const access = await canJoinMeeting({
      meetingId, userId: req.user!.id, userRole: req.user!.role,
    });
    if (!access.ok) {
      // 업로드된 파일 즉시 삭제 (다음 요청에서 중복 방지)
      if (file.path) fs.unlink(file.path, () => { /* ignore */ });
      res.status(access.reason === 'NOT_FOUND' ? 404 : 403).json({
        success: false,
        error: {
          code: access.reason === 'NOT_FOUND' ? 'MEETING_NOT_FOUND' : 'MEETING_ACCESS_DENIED',
          message: access.reason === 'NOT_FOUND' ? '회의를 찾을 수 없습니다' : '이 회의에 참여 권한이 없습니다',
        },
      });
      return;
    }

    // 사용자 정보
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true },
    });

    const doc: SharedDocMeta = {
      id: crypto.randomUUID(),
      fileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      storedName: file.filename,
      fileSize: file.size,
      mimeType: file.mimetype,
      sharedBy: user?.name || '알 수 없음',
      sharedById: req.user!.id,
      sharedAt: new Date().toISOString(),
    };

    // 메타데이터 저장
    const meta = readMeta(meetingId);
    meta.push(doc);
    writeMeta(meetingId, meta);

    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    logger.error({ err, userId: req.user?.id, meetingId: req.params.id }, '[Meeting Document] 업로드 실패');
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: '업로드에 실패했습니다' } });
  }
});

// GET /meeting/:id/documents — 공유 문서 목록 (참가 이력자/호스트/관리자만)
router.get('/:id/documents', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const access = await canViewMeeting({
      meetingId, userId: req.user!.id, userRole: req.user!.role,
    });
    if (!access.ok) {
      res.status(access.reason === 'NOT_FOUND' ? 404 : 403).json({
        success: false,
        error: {
          code: access.reason === 'NOT_FOUND' ? 'MEETING_NOT_FOUND' : 'MEETING_ACCESS_DENIED',
          message: access.reason === 'NOT_FOUND' ? '회의를 찾을 수 없습니다' : '이 회의의 문서를 조회할 권한이 없습니다',
        },
      });
      return;
    }

    const docs = readMeta(meetingId);
    res.json({ success: true, data: docs });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /meeting/:id/documents/:docId/file — 파일 스트림 (참가 이력자/호스트/관리자만)
router.get('/:id/documents/:docId/file', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const docId = qs(req.params.docId);

    const access = await canViewMeeting({
      meetingId, userId: req.user!.id, userRole: req.user!.role,
    });
    if (!access.ok) {
      res.status(access.reason === 'NOT_FOUND' ? 404 : 403).json({
        success: false,
        error: {
          code: access.reason === 'NOT_FOUND' ? 'MEETING_NOT_FOUND' : 'MEETING_ACCESS_DENIED',
          message: access.reason === 'NOT_FOUND' ? '회의를 찾을 수 없습니다' : '파일 다운로드 권한이 없습니다',
        },
      });
      return;
    }

    const meta = readMeta(meetingId);
    const doc = meta.find((d) => d.id === docId);

    if (!doc) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
      return;
    }

    const filePath = path.resolve(config.upload.dir, 'meetings', meetingId, doc.storedName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '파일이 존재하지 않습니다' } });
      return;
    }

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /meeting/:id/documents/:docId — 문서 삭제
router.delete('/:id/documents/:docId', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const docId = qs(req.params.docId);
    const meta = readMeta(meetingId);
    const idx = meta.findIndex((d) => d.id === docId);

    if (idx < 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
      return;
    }

    const doc = meta[idx];
    // 본인 또는 관리자만 삭제 가능
    if (doc.sharedById !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }

    // 파일 삭제
    const filePath = path.resolve(config.upload.dir, 'meetings', meetingId, doc.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    meta.splice(idx, 1);
    writeMeta(meetingId, meta);

    res.json({ success: true, data: { message: '삭제되었습니다', documentId: docId } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 회의록 (minutes) & 전사(transcripts) =====
//
// 접근 규칙: canViewMeeting (호스트/초대/참여이력/관리자만)
// 편집/확정: 호스트 또는 관리자만
// 재생성: 호스트만, final 상태가 아니어야 함 (regenerate=true 시 예외)

// GET /meeting/:id/minutes — 회의록 조회 (status 포함)
router.get('/:id/minutes', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const access = await canViewMeeting({ meetingId, userId: req.user!.id, userRole: req.user!.role });
    if (!access.ok) {
      const code = access.reason || 'NOT_ALLOWED';
      const status = code === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code, message: '접근 권한이 없습니다' } });
      return;
    }

    const minutes = await prisma.meetingMinutes.findUnique({
      where: { meetingId },
      include: { finalizedBy: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: minutes }); // null이면 아직 생성 전
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /meeting/:id/transcripts — 전사(원문 발언) 조회 — 시간순
router.get('/:id/transcripts', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const access = await canViewMeeting({ meetingId, userId: req.user!.id, userRole: req.user!.role });
    if (!access.ok) {
      const code = access.reason || 'NOT_ALLOWED';
      const status = code === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code, message: '접근 권한이 없습니다' } });
      return;
    }
    const rows = await prisma.meetingTranscript.findMany({
      where: { meetingId },
      orderBy: { timestamp: 'asc' },
      select: { id: true, speakerId: true, speakerName: true, text: true, timestamp: true },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /meeting/:id/minutes — 회의록 편집 (호스트/관리자만, final 상태 아닐 때)
const minutesPatchSchema = z.object({
  summary: z.string().max(20000).optional(),
  topics: z.array(z.string().max(500)).max(50).optional(),
  decisions: z.array(z.string().max(1000)).max(50).optional(),
  actionItems: z
    .array(
      z.object({
        assignee: z.string().min(1).max(100),
        task: z.string().min(1).max(500),
        dueDate: z.string().max(20).optional(),
      }),
    )
    .max(50)
    .optional(),
});

router.patch('/:id/minutes', authenticate, validate(minutesPatchSchema), async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { hostId: true } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    const isHost = meeting.hostId === req.user!.id;
    const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
    if (!isHost && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트/관리자만 편집 가능합니다' } });
      return;
    }

    const minutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
    if (!minutes) {
      res.status(404).json({ success: false, error: { code: 'MINUTES_NOT_FOUND', message: '회의록이 아직 생성되지 않았습니다' } });
      return;
    }
    if (minutes.status === 'final') {
      res.status(400).json({ success: false, error: { code: 'MINUTES_FINALIZED', message: '확정된 회의록은 편집할 수 없습니다' } });
      return;
    }

    await updateMinutes(minutes.id, req.body);
    const updated = await prisma.meetingMinutes.findUnique({ where: { id: minutes.id } });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/minutes/finalize — 회의록 확정 (잠금, 호스트/관리자)
router.post('/:id/minutes/finalize', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { hostId: true } });
    if (!meeting) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
      return;
    }
    const isHost = meeting.hostId === req.user!.id;
    const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
    if (!isHost && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트/관리자만 확정할 수 있습니다' } });
      return;
    }

    const minutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
    if (!minutes) {
      res.status(404).json({ success: false, error: { code: 'MINUTES_NOT_FOUND', message: '회의록이 아직 생성되지 않았습니다' } });
      return;
    }
    if (minutes.status === 'final') {
      res.status(400).json({ success: false, error: { code: 'ALREADY_FINALIZED', message: '이미 확정된 회의록입니다' } });
      return;
    }
    if (minutes.status === 'generating') {
      res.status(400).json({ success: false, error: { code: 'STILL_GENERATING', message: '생성이 완료된 후 확정할 수 있습니다' } });
      return;
    }

    await finalizeMinutes(minutes.id, req.user!.id);
    const updated = await prisma.meetingMinutes.findUnique({
      where: { id: minutes.id },
      include: { finalizedBy: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /meeting/:id/minutes/regenerate — 회의록 재생성 (호스트/관리자)
// - failed/draft 상태에서 수동 재시도 가능
// - final이라도 강제로 regenerate하려면 body.force=true (관리자만)
const regenerateSchema = z.object({ force: z.boolean().optional() });

router.post(
  '/:id/minutes/regenerate',
  authenticate,
  validate(regenerateSchema),
  async (req: Request, res: Response) => {
    try {
      const meetingId = qs(req.params.id);
      const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { hostId: true } });
      if (!meeting) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '회의를 찾을 수 없습니다' } });
        return;
      }
      const isHost = meeting.hostId === req.user!.id;
      const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
      if (!isHost && !isAdmin) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '호스트/관리자만 재생성 가능합니다' } });
        return;
      }

      const force = Boolean(req.body?.force && isAdmin); // 강제 덮어쓰기는 관리자만
      const result = await generateMinutes(meetingId, { regenerate: force });
      if (!result.ok) {
        const status = result.reason === 'ALREADY_FINALIZED' ? 400
          : result.reason === 'ANTHROPIC_DISABLED' ? 503
          : result.reason === 'NO_TRANSCRIPTS' ? 400
          : 500;
        res.status(status).json({
          success: false,
          error: {
            code: result.reason,
            message:
              result.reason === 'ALREADY_FINALIZED' ? '이미 확정된 회의록입니다 (force=true + 관리자만 재생성 가능)'
              : result.reason === 'ANTHROPIC_DISABLED' ? '서버에 ANTHROPIC_API_KEY가 설정되지 않아 자동 요약을 사용할 수 없습니다'
              : result.reason === 'NO_TRANSCRIPTS' ? '저장된 발언 기록이 없습니다'
              : 'Claude 요약 중 오류가 발생했습니다',
          },
        });
        return;
      }
      const minutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
      res.json({ success: true, data: minutes });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

export default router;
