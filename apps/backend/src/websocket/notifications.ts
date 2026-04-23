/**
 * /notifications Socket.IO 네임스페이스
 *
 * - JWT 기반 인증
 * - 각 사용자는 `user:<userId>` 룸에 자동 join
 * - notificationService.create()가 emitToUser()를 호출해 실시간 푸시
 *
 * 발행 이벤트:
 *   'notification:new'       — 새 알림 1건 도착 (Notification payload)
 *   'notification:unread'    — 읽지 않은 알림 총 갯수 변경 (count)
 */
import { Server as SocketIOServer, type Namespace, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../config/logger';
import type { JwtPayload } from '../middleware/authenticate';

interface NotifSocket extends Socket {
  data: { user: JwtPayload };
}

let notifNsp: Namespace | null = null;

export function setupNotificationSocket(io: SocketIOServer): Namespace {
  const notif = io.of('/notifications');

  notif.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('UNAUTHORIZED'));
    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
      (socket as NotifSocket).data.user = decoded;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  notif.on('connection', (socket: Socket) => {
    const typed = socket as NotifSocket;
    const userId = typed.data.user.sub;
    typed.join(userRoom(userId));
    logger.debug({ userId }, '[notification-ws] client connected');

    typed.on('disconnect', () => {
      logger.debug({ userId }, '[notification-ws] client disconnected');
    });
  });

  notifNsp = notif;
  return notif;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** 특정 유저에게 새 알림 1건 emit */
export function emitNewNotification(userId: string, payload: unknown): void {
  if (!notifNsp) return;
  notifNsp.to(userRoom(userId)).emit('notification:new', payload);
}

/** 특정 유저의 미확인 알림 갯수 변경 emit */
export function emitUnreadCount(userId: string, count: number): void {
  if (!notifNsp) return;
  notifNsp.to(userRoom(userId)).emit('notification:unread', { count });
}
