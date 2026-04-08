import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { AppError } from '../services/auth.service';

const router = Router();
router.use(checkModule('messenger'));

// ===== 채팅방 =====

// GET /messenger/rooms - 내 채팅방 목록
router.get('/rooms', authenticate, async (req: Request, res: Response) => {
  try {
    const rooms = await prisma.chatRoom.findMany({
      where: {
        isActive: true,
        participants: { some: { userId: req.user!.id, leftAt: null } },
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

    // 안읽은 메시지 수 계산
    const roomsWithUnread = await Promise.all(
      rooms.map(async (room) => {
        const participant = room.participants.find(p => p.userId === req.user!.id);
        const unreadCount = participant
          ? await prisma.message.count({
              where: {
                roomId: room.id,
                createdAt: { gt: participant.lastReadAt },
                senderId: { not: req.user!.id },
                isDeleted: false,
              },
            })
          : 0;

        return {
          ...room,
          unreadCount,
          lastMessage: room.messages[0] || null,
        };
      }),
    );

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
    const roomId = req.params.id;
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;

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
    const roomId = req.params.id;

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

export default router;
