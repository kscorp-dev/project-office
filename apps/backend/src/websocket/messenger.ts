import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/prisma';
import { JwtPayload } from '../middleware/authenticate';
import { logger } from '../config/logger';

interface AuthSocket extends Socket {
  data: { user: JwtPayload };
}

export function setupMessengerSocket(io: SocketIOServer) {
  const messenger = io.of('/messenger');

  // JWT 인증 미들웨어
  messenger.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('UNAUTHORIZED'));

    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
      socket.data.user = decoded;
      next();
    } catch (err) {
      logger.warn({ err }, 'Internal error');
      next(new Error('INVALID_TOKEN'));
    }
  });

  messenger.on('connection', (socket: AuthSocket) => {
    const userId = socket.data.user.sub;

    // 사용자의 모든 채팅방에 join
    joinUserRooms(socket, userId);

    // 메시지 전송
    socket.on('message:send', async (data: {
      roomId: string;
      content: string;
      type?: string;
      metadata?: Record<string, unknown>;
      parentId?: string;
      mentionIds?: string[];
    }) => {
      try {
        const { roomId, content, type = 'text', metadata, parentId, mentionIds } = data;

        // 참여자 확인
        const participant = await prisma.chatParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });
        if (!participant || participant.leftAt) {
          socket.emit('error', { code: 'NOT_MEMBER' });
          return;
        }

        // 메시지 저장
        const message = await prisma.$transaction(async (tx) => {
          const msg = await tx.message.create({
            data: { roomId, senderId: userId, content, type: type as any, metadata: (metadata || undefined) as any, parentId },
            include: {
              sender: { select: { id: true, name: true, profileImage: true } },
            },
          });

          if (mentionIds && mentionIds.length > 0) {
            await tx.messageMention.createMany({
              data: mentionIds.map((uid: string) => ({ messageId: msg.id, userId: uid })),
            });
          }

          await tx.chatRoom.update({
            where: { id: roomId },
            data: { updatedAt: new Date() },
          });

          return msg;
        });

        // 방 전체에 브로드캐스트
        messenger.to(roomId).emit('message:new', message);
      } catch (err) {
        socket.emit('error', { code: 'SEND_FAILED' });
      }
    });

    // 읽음 처리 — 본인이 활성 참가자인 룸만 처리 (audit C3)
    socket.on('message:read', async (data: { roomId: string }) => {
      try {
        // updateMany + 명시적 leftAt: null 조건으로 비참가/탈퇴 사용자가 임의 룸의 lastReadAt 변경 차단
        const result = await prisma.chatParticipant.updateMany({
          where: { roomId: data.roomId, userId, leftAt: null },
          data: { lastReadAt: new Date() },
        });
        if (result.count === 0) return; // 비참가자였음 — 브로드캐스트도 차단
        messenger.to(data.roomId).emit('message:read', { userId, roomId: data.roomId });
      } catch {}
    });

    // 타이핑 — 본인이 활성 참가자인 룸만 broadcast 허용 (audit C3)
    //   in-memory 캐시 없이 DB 조회는 매 keystroke 마다 부담 → 첫 접근 시 검사하고
    //   socket.data 에 멤버십 set 캐시. 룸 leave/추가 시 socket.io adapter 가 갱신해줘야 하나
    //   여기서는 단순화 — 1분 TTL 캐시.
    const TYPING_MEMBERSHIP_TTL_MS = 60_000;
    const membership = new Map<string, number>(); // roomId → expiresAt
    async function isActiveMember(roomId: string): Promise<boolean> {
      const exp = membership.get(roomId);
      if (exp && Date.now() < exp) return true;
      const found = await prisma.chatParticipant.findFirst({
        where: { roomId, userId, leftAt: null },
        select: { id: true },
      });
      if (found) {
        membership.set(roomId, Date.now() + TYPING_MEMBERSHIP_TTL_MS);
        return true;
      }
      return false;
    }
    socket.on('typing:start', async (data: { roomId: string }) => {
      if (!(await isActiveMember(data.roomId))) return;
      socket.to(data.roomId).emit('typing:start', { userId, roomId: data.roomId });
    });
    socket.on('typing:stop', async (data: { roomId: string }) => {
      if (!(await isActiveMember(data.roomId))) return;
      socket.to(data.roomId).emit('typing:stop', { userId, roomId: data.roomId });
    });

    socket.on('disconnect', () => {
      // 오프라인 상태 브로드캐스트
      messenger.emit('presence:offline', { userId });
    });
  });
}

async function joinUserRooms(socket: AuthSocket, userId: string) {
  const rooms = await prisma.chatParticipant.findMany({
    where: { userId, leftAt: null },
    select: { roomId: true },
  });

  for (const room of rooms) {
    socket.join(room.roomId);
  }

  // 온라인 상태 브로드캐스트
  socket.broadcast.emit('presence:online', { userId });
}
