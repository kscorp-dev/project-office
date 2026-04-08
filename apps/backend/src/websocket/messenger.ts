import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/prisma';
import { JwtPayload } from '../middleware/authenticate';

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
    } catch {
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
      parentId?: string;
      mentionIds?: string[];
    }) => {
      try {
        const { roomId, content, type = 'text', parentId, mentionIds } = data;

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
            data: { roomId, senderId: userId, content, type: type as any, parentId },
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

    // 읽음 처리
    socket.on('message:read', async (data: { roomId: string }) => {
      try {
        await prisma.chatParticipant.update({
          where: { roomId_userId: { roomId: data.roomId, userId } },
          data: { lastReadAt: new Date() },
        });

        messenger.to(data.roomId).emit('message:read', { userId, roomId: data.roomId });
      } catch {}
    });

    // 타이핑 표시
    socket.on('typing:start', (data: { roomId: string }) => {
      socket.to(data.roomId).emit('typing:start', { userId, roomId: data.roomId });
    });

    socket.on('typing:stop', (data: { roomId: string }) => {
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
