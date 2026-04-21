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
  } catch {
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
  } catch {
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

    res.status(201).json({ success: true, data: meeting });
  } catch {
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
  } catch {
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
  } catch {
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

    res.json({ success: true, data: updated });
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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

// POST /meeting/:id/documents — 문서 업로드
router.post('/:id/documents', authenticate, meetingUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '파일이 첨부되지 않았습니다' } });
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
  } catch (err: any) {
    console.error('[Meeting Document] Upload error:', err);
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: err.message || '업로드 실패' } });
  }
});

// GET /meeting/:id/documents — 공유 문서 목록
router.get('/:id/documents', authenticate, async (req: Request, res: Response) => {
  try {
    const docs = readMeta(qs(req.params.id));
    res.json({ success: true, data: docs });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /meeting/:id/documents/:docId/file — 파일 스트림
router.get('/:id/documents/:docId/file', authenticate, async (req: Request, res: Response) => {
  try {
    const meetingId = qs(req.params.id);
    const docId = qs(req.params.docId);
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
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
