import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { config } from '../config';
import { AppError } from '../services/auth.service';
import { qs, qsOpt } from '../utils/query';
import { messengerFileFilter } from '../utils/fileFilter';

const router = Router();
router.use(checkModule('messenger'));

// ===== 파일 업로드 설정 =====
const messengerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(config.upload.dir, 'messenger');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const messengerUpload = multer({
  storage: messengerStorage,
  limits: { fileSize: config.upload.maxFileSize },
  // 확장자 + MIME 타입 교차 검증 (경로 traversal, 실행 파일 차단 포함)
  fileFilter: messengerFileFilter,
});

// ===== 채팅방 =====

// GET /messenger/rooms - 내 채팅방 목록
router.get('/rooms', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const rooms = await prisma.chatRoom.findMany({
      where: {
        isActive: true,
        participants: { some: { userId, leftAt: null } },
      },
      include: {
        participants: {
          where: { leftAt: null },
          include: { user: { select: { id: true, name: true, profileImage: true, status: true } } },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { content: true, type: true, createdAt: true, sender: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // N+1 제거: 모든 방의 안읽음 카운트를 단일 쿼리로
    // participants의 last_read_at을 join해 각 방별로 COUNT 계산
    let unreadMap = new Map<string, number>();
    if (rooms.length > 0) {
      const roomIds = rooms.map((r) => r.id);
      const rows = await prisma.$queryRaw<Array<{ room_id: string; cnt: bigint }>>`
        SELECT m.room_id, COUNT(*)::bigint AS cnt
        FROM messages m
        INNER JOIN chat_participants p
          ON p.room_id = m.room_id
          AND p.user_id = ${userId}
          AND p.left_at IS NULL
        WHERE m.room_id IN (${Prisma.join(roomIds)})
          AND m.created_at > p.last_read_at
          AND (m.sender_id IS NULL OR m.sender_id <> ${userId})
          AND m.is_deleted = false
        GROUP BY m.room_id
      `;
      unreadMap = new Map(rows.map((r) => [r.room_id, Number(r.cnt)]));
    }

    const roomsWithUnread = rooms.map((room) => ({
      ...room,
      unreadCount: unreadMap.get(room.id) ?? 0,
      lastMessage: room.messages[0] || null,
    }));

    res.json({ success: true, data: roomsWithUnread });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /messenger/rooms - 채팅방 생성
const createRoomSchema = z.object({
  type: z.enum(['direct', 'group']),
  name: z.string().max(100).optional(),
  participantIds: z.array(z.string().uuid()).min(1),
});

router.post('/rooms', authenticate, validate(createRoomSchema), async (req: Request, res: Response) => {
  try {
    const { type, name, participantIds } = req.body;
    const allParticipants = [...new Set([req.user!.id, ...participantIds])];

    // 1:1 채팅은 기존 방 확인
    if (type === 'direct' && allParticipants.length === 2) {
      const existing = await prisma.chatRoom.findFirst({
        where: {
          type: 'direct',
          isActive: true,
          AND: allParticipants.map(id => ({
            participants: { some: { userId: id, leftAt: null } },
          })),
        },
      });
      if (existing) {
        res.json({ success: true, data: existing });
        return;
      }
    }

    const room = await prisma.chatRoom.create({
      data: {
        type,
        name: type === 'group' ? name || '그룹 채팅' : null,
        creatorId: req.user!.id,
        participants: {
          create: allParticipants.map((userId) => ({ userId })),
        },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, name: true, profileImage: true } } },
        },
      },
    });

    res.status(201).json({ success: true, data: room });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /messenger/rooms/:id/messages - 메시지 목록
router.get('/rooms/:id/messages', authenticate, async (req: Request, res: Response) => {
  try {
    const roomId = qs(req.params.id);
    const cursor = qsOpt(req.query.cursor);
    const limit = parseInt(qs(req.query.limit)) || 50;

    // 참여자 확인
    const participant = await prisma.chatParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user!.id } },
    });
    if (!participant || participant.leftAt) {
      res.status(403).json({ success: false, error: { code: 'NOT_MEMBER', message: '채팅방 멤버가 아닙니다' } });
      return;
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      include: {
        sender: { select: { id: true, name: true, profileImage: true } },
        mentions: { include: { user: { select: { id: true, name: true } } } },
        _count: { select: { reads: true } },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    // 읽음 처리
    await prisma.chatParticipant.update({
      where: { roomId_userId: { roomId, userId: req.user!.id } },
      data: { lastReadAt: new Date() },
    });

    res.json({
      success: true,
      data: messages.reverse(),
      meta: { hasMore: messages.length === limit },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /messenger/rooms/:id/messages - 메시지 전송 (REST fallback)
const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  type: z.enum(['text', 'image', 'file', 'system']).default('text'),
  metadata: z.record(z.unknown()).optional(),
  parentId: z.string().uuid().optional(),
  mentionIds: z.array(z.string().uuid()).optional(),
});

router.post('/rooms/:id/messages', authenticate, validate(sendMessageSchema), async (req: Request, res: Response) => {
  try {
    const roomId = qs(req.params.id);

    const participant = await prisma.chatParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user!.id } },
    });
    if (!participant || participant.leftAt) {
      res.status(403).json({ success: false, error: { code: 'NOT_MEMBER', message: '채팅방 멤버가 아닙니다' } });
      return;
    }

    const { mentionIds, ...messageData } = req.body;

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          roomId,
          senderId: req.user!.id,
          ...messageData,
        },
        include: {
          sender: { select: { id: true, name: true, profileImage: true } },
        },
      });

      // 멘션 저장
      if (mentionIds && mentionIds.length > 0) {
        await tx.messageMention.createMany({
          data: mentionIds.map((userId: string) => ({ messageId: msg.id, userId })),
        });
      }

      // 채팅방 업데이트 시간 갱신
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });

      return msg;
    });

    res.status(201).json({ success: true, data: message });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /messenger/rooms/:id/upload - 파일 전송
router.post('/rooms/:id/upload', authenticate, messengerUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const roomId = qs(req.params.id);
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '파일이 없습니다' } });
      return;
    }

    // 참여자 확인
    const participant = await prisma.chatParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user!.id } },
    });
    if (!participant || participant.leftAt) {
      // 업로드된 파일 삭제
      fs.unlinkSync(file.path);
      res.status(403).json({ success: false, error: { code: 'NOT_MEMBER', message: '채팅방 멤버가 아닙니다' } });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
    const msgType = isImage ? 'image' : 'file';

    const metadata = {
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      filePath: `/uploads/messenger/${file.filename}`,
    };

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          roomId,
          senderId: req.user!.id,
          content: file.originalname,
          type: msgType as any,
          metadata,
        },
        include: {
          sender: { select: { id: true, name: true, profileImage: true } },
        },
      });

      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });

      return msg;
    });

    // Socket.IO로 다른 참여자에게 브로드캐스트
    const io = req.app.get('io');
    if (io) {
      io.of('/messenger').to(roomId).emit('message:new', message);
    }

    res.status(201).json({ success: true, data: message });
  } catch (err: any) {
    console.error('File upload error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '파일 업로드 중 오류가 발생했습니다' } });
  }
});

// GET /messenger/unread - 전체 안읽은 메시지 수
router.get('/unread', authenticate, async (req: Request, res: Response) => {
  try {
    const participants = await prisma.chatParticipant.findMany({
      where: { userId: req.user!.id, leftAt: null },
    });

    let totalUnread = 0;
    for (const p of participants) {
      const count = await prisma.message.count({
        where: {
          roomId: p.roomId,
          createdAt: { gt: p.lastReadAt },
          senderId: { not: req.user!.id },
          isDeleted: false,
        },
      });
      totalUnread += count;
    }

    res.json({ success: true, data: { unread: totalUnread } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 메시지 수정 / 삭제 (SEND-008/009) =====
//
// 정책:
//   - 발신자 본인만 수정/삭제 가능
//   - 수정: 발송 후 1시간 이내, 텍스트 타입만 (파일/이미지는 수정 불가)
//   - 삭제: 발송 후 24시간 이내 하드리밋(관리자는 언제든), soft delete (isDeleted=true)
//   - WebSocket으로 같은 방의 모든 참가자에게 브로드캐스트

const MESSAGE_EDIT_WINDOW_MS = 60 * 60 * 1000;       // 1시간
const MESSAGE_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24시간

const editMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

// PATCH /messenger/rooms/:roomId/messages/:msgId — 메시지 수정
router.patch(
  '/rooms/:roomId/messages/:msgId',
  authenticate,
  validate(editMessageSchema),
  async (req: Request, res: Response) => {
    try {
      const roomId = qs(req.params.roomId);
      const msgId = qs(req.params.msgId);

      const msg = await prisma.message.findUnique({ where: { id: msgId } });
      if (!msg || msg.roomId !== roomId) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '메시지를 찾을 수 없습니다' } });
        return;
      }
      if (msg.senderId !== req.user!.id) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '본인의 메시지만 수정할 수 있습니다' } });
        return;
      }
      if (msg.isDeleted) {
        res.status(400).json({ success: false, error: { code: 'DELETED', message: '삭제된 메시지는 수정할 수 없습니다' } });
        return;
      }
      if (msg.type !== 'text') {
        res.status(400).json({ success: false, error: { code: 'INVALID_TYPE', message: '텍스트 메시지만 수정 가능합니다' } });
        return;
      }
      if (Date.now() - msg.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
        res.status(400).json({ success: false, error: { code: 'WINDOW_EXCEEDED', message: '수정 가능 시간(1시간)이 지났습니다' } });
        return;
      }

      const updated = await prisma.message.update({
        where: { id: msgId },
        data: { content: req.body.content, isEdited: true },
        include: {
          sender: { select: { id: true, name: true, profileImage: true } },
        },
      });

      // WebSocket 브로드캐스트 (io는 app.locals에 저장돼 있지만, 각 네임스페이스에서 emit)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const io = req.app.get('io') as any;
      if (io) {
        io.of('/messenger').to(roomId).emit('message:edited', {
          messageId: updated.id,
          roomId,
          content: updated.content,
          isEdited: true,
          updatedAt: updated.updatedAt,
        });
      }

      res.json({ success: true, data: updated });
    } catch {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// DELETE /messenger/rooms/:roomId/messages/:msgId — 메시지 삭제 (soft)
router.delete('/rooms/:roomId/messages/:msgId', authenticate, async (req: Request, res: Response) => {
  try {
    const roomId = qs(req.params.roomId);
    const msgId = qs(req.params.msgId);

    const msg = await prisma.message.findUnique({ where: { id: msgId } });
    if (!msg || msg.roomId !== roomId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '메시지를 찾을 수 없습니다' } });
      return;
    }

    const isOwner = msg.senderId === req.user!.id;
    const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
    if (!isOwner && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '본인의 메시지만 삭제할 수 있습니다' } });
      return;
    }
    if (msg.isDeleted) {
      res.status(400).json({ success: false, error: { code: 'ALREADY_DELETED', message: '이미 삭제된 메시지입니다' } });
      return;
    }
    if (isOwner && !isAdmin && Date.now() - msg.createdAt.getTime() > MESSAGE_DELETE_WINDOW_MS) {
      res.status(400).json({ success: false, error: { code: 'WINDOW_EXCEEDED', message: '삭제 가능 시간(24시간)이 지났습니다. 관리자에게 문의하세요' } });
      return;
    }

    await prisma.message.update({
      where: { id: msgId },
      data: { isDeleted: true, content: '' }, // 내용 제거 (soft-delete)
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const io = req.app.get('io') as any;
    if (io) {
      io.of('/messenger').to(roomId).emit('message:deleted', {
        messageId: msgId,
        roomId,
        deletedBy: req.user!.id,
      });
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
