import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
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
import { logger } from '../config/logger';
import { createNotification } from '../services/notification.service';

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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
// v0.19.0 성능 최적화: N+1 제거 — raw SQL로 한 번에 집계
router.get('/unread', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(m.id)::bigint AS total
      FROM chat_participants cp
      INNER JOIN messages m
        ON m.room_id = cp.room_id
        AND m.created_at > cp.last_read_at
        AND m.sender_id <> ${userId}
        AND m.is_deleted = false
      WHERE cp.user_id = ${userId}
        AND cp.left_at IS NULL
    `;
    const totalUnread = Number(result[0]?.total ?? 0);
    res.json({ success: true, data: { unread: totalUnread } });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
    } catch (err) {
      logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 그룹 채팅 멤버 관리 (P1-C) =====

// GET /messenger/rooms/:id - 채팅방 정보 + 멤버 (활성)
router.get('/rooms/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const roomId = qs(req.params.id);
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        participants: {
          where: { leftAt: null },
          include: {
            user: {
              select: {
                id: true, name: true, profileImage: true, position: true, employeeId: true,
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!room) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '채팅방을 찾을 수 없습니다' } });
      return;
    }
    // 본인이 참가자인지 확인
    const isMember = room.participants.some((p) => p.userId === req.user!.id);
    if (!isMember && !['admin', 'super_admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '참가자만 정보를 볼 수 있습니다' } });
      return;
    }
    res.json({
      success: true,
      data: {
        id: room.id,
        name: room.name,
        type: room.type,
        creatorId: room.creatorId,
        isActive: room.isActive,
        createdAt: room.createdAt,
        members: room.participants.map((p) => ({
          userId: p.userId,
          joinedAt: p.joinedAt,
          isCreator: p.userId === room.creatorId,
          user: p.user,
        })),
      },
    });
  } catch (err) {
    logger.warn({ err, path: req.path }, 'get room failed');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /messenger/rooms/:id/members - 그룹 채팅방에 멤버 추가
const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});

// 대량 초대 abuse 방지 — 사용자별 분당 5회 (방당 50명 × 5 = 분당 최대 250명 초대)
// NODE_ENV=test 면 비활성화 (각 it() 사이 reset 없이 sequential 호출 시 false-positive)
const memberAddLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '멤버 초대는 분당 5회까지 가능합니다' } },
  keyGenerator: (req) => `${req.user?.id ?? 'anon'}:room-member-add`,
  skip: () => process.env.NODE_ENV === 'test',
});

router.post(
  '/rooms/:id/members',
  authenticate,
  memberAddLimiter,
  validate(addMembersSchema),
  async (req: Request, res: Response) => {
    try {
      const roomId = qs(req.params.id);
      const { userIds } = req.body as { userIds: string[] };

      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        include: { participants: true },
      });
      if (!room) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '채팅방을 찾을 수 없습니다' } });
        return;
      }
      if (room.type !== 'group') {
        res.status(400).json({ success: false, error: { code: 'NOT_GROUP', message: '1:1 채팅에는 멤버를 추가할 수 없습니다' } });
        return;
      }
      // 권한: 방장 또는 admin 만 멤버 추가 가능 (DELETE 와 정책 일치 — H5)
      //   - 일반 멤버는 외부인을 임의로 초대할 수 없음
      const requester = room.participants.find((p) => p.userId === req.user!.id && !p.leftAt);
      const isCreator = room.creatorId === req.user!.id;
      const isAdmin = ['admin', 'super_admin'].includes(req.user!.role);
      if (!requester) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '참가자가 아닙니다' } });
        return;
      }
      if (!isCreator && !isAdmin) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '방장만 멤버를 추가할 수 있습니다' } });
        return;
      }

      // 이미 활성 멤버인 사용자 제외 — 떠난 사람(leftAt 존재)은 다시 합류 처리
      const existingActiveIds = new Set(
        room.participants.filter((p) => !p.leftAt).map((p) => p.userId),
      );
      const toAdd = userIds.filter((uid) => !existingActiveIds.has(uid));
      const rejoinIds: string[] = [];
      const newCreateIds: string[] = [];
      for (const uid of toAdd) {
        const existed = room.participants.find((p) => p.userId === uid);
        if (existed) rejoinIds.push(uid);
        else newCreateIds.push(uid);
      }

      // 활성 사용자만 추가 (검증)
      if (newCreateIds.length > 0 || rejoinIds.length > 0) {
        const targets = await prisma.user.findMany({
          where: { id: { in: [...newCreateIds, ...rejoinIds] }, status: 'active' },
          select: { id: true },
        });
        const validIds = new Set(targets.map((u) => u.id));
        const invalid = [...newCreateIds, ...rejoinIds].filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
          res.status(400).json({ success: false, error: { code: 'INVALID_USERS', message: '비활성 또는 존재하지 않는 사용자가 포함되어 있습니다' } });
          return;
        }
      }

      // 트랜잭션으로 추가
      const adderName = (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } }))?.name ?? '관리자';
      await prisma.$transaction(async (tx) => {
        if (newCreateIds.length > 0) {
          await tx.chatParticipant.createMany({
            data: newCreateIds.map((userId) => ({ roomId, userId })),
            skipDuplicates: true,
          });
        }
        if (rejoinIds.length > 0) {
          // 떠났던 사람들 재합류 — leftAt=null 로 복원, joinedAt 새로
          await tx.chatParticipant.updateMany({
            where: { roomId, userId: { in: rejoinIds } },
            data: { leftAt: null, joinedAt: new Date() },
          });
        }
        // 시스템 메시지 작성 (그룹 룸 메시지 흐름에 자연스럽게 노출)
        if (toAdd.length > 0) {
          const targets = await tx.user.findMany({
            where: { id: { in: toAdd } },
            select: { name: true },
          });
          const names = targets.map((t) => t.name).join(', ');
          await tx.message.create({
            data: {
              roomId,
              senderId: req.user!.id,
              type: 'system',
              content: `${adderName}님이 ${names}님을 초대했습니다`,
            },
          });
        }
      });

      // 실시간 룸 멤버 변경 알림
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const io = req.app.get('io') as any;
      if (io) {
        io.of('/messenger').to(roomId).emit('room:members:added', {
          roomId, addedUserIds: toAdd, byUserId: req.user!.id,
        });
      }

      // 새로 추가된 사용자에게 푸시 알림 (오프라인 상태에서도 채팅에 초대됐음을 인지) — H3
      const roomTitle = room.name ?? '그룹 채팅';
      await Promise.allSettled(
        toAdd.map((uid) =>
          createNotification({
            recipientId: uid,
            actorId: req.user!.id,
            type: 'message_received',
            title: `${roomTitle}`,
            body: `${adderName}님이 회원님을 그룹 대화에 초대했습니다`,
            link: `/messenger/room/${roomId}`,
            refType: 'messenger_room',
            refId: roomId,
          }),
        ),
      );

      res.json({
        success: true,
        data: { added: toAdd.length, alreadyMember: userIds.length - toAdd.length },
      });
    } catch (err) {
      logger.warn({ err, path: req.path }, 'add members failed');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// DELETE /messenger/rooms/:id/members/:userId - 멤버 제거 (방장 또는 본인 leave)
router.delete(
  '/rooms/:id/members/:userId',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const roomId = qs(req.params.id);
      const targetUserId = qs(req.params.userId);

      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        include: { participants: { where: { leftAt: null } } },
      });
      if (!room) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '채팅방을 찾을 수 없습니다' } });
        return;
      }
      if (room.type !== 'group') {
        res.status(400).json({ success: false, error: { code: 'NOT_GROUP', message: '1:1 채팅에는 멤버 제거가 없습니다' } });
        return;
      }

      const requester = room.participants.find((p) => p.userId === req.user!.id);
      if (!requester) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '참가자만 가능합니다' } });
        return;
      }

      const isSelf = targetUserId === req.user!.id;
      const isCreator = room.creatorId === req.user!.id;
      const isAdmin = ['admin', 'super_admin'].includes(req.user!.role);
      // 방장 본인이 자신을 제거하려는 경우는 허용 (그룹 떠나기) — 마지막 멤버라면 룸 비활성화는 별도 처리
      if (!isSelf && !isCreator && !isAdmin) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '방장만 다른 멤버를 제거할 수 있습니다' } });
        return;
      }

      const targetParticipant = room.participants.find((p) => p.userId === targetUserId);
      if (!targetParticipant) {
        res.status(404).json({ success: false, error: { code: 'MEMBER_NOT_FOUND', message: '해당 멤버는 이미 떠났거나 참가자가 아닙니다' } });
        return;
      }

      const targetName = (await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } }))?.name ?? '?';
      const actorName = (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } }))?.name ?? '관리자';

      await prisma.$transaction(async (tx) => {
        await tx.chatParticipant.update({
          where: { id: targetParticipant.id },
          data: { leftAt: new Date() },
        });
        await tx.message.create({
          data: {
            roomId,
            senderId: req.user!.id,
            type: 'system',
            content: isSelf
              ? `${targetName}님이 나갔습니다`
              : `${actorName}님이 ${targetName}님을 내보냈습니다`,
          },
        });
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const io = req.app.get('io') as any;
      if (io) {
        io.of('/messenger').to(roomId).emit('room:members:removed', {
          roomId, removedUserId: targetUserId, byUserId: req.user!.id, isSelf,
        });
      }

      res.json({ success: true });
    } catch (err) {
      logger.warn({ err, path: req.path }, 'remove member failed');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

export default router;
