/**
 * /mail Socket.IO 네임스페이스
 *
 * - JWT 기반 인증
 * - 각 사용자는 `user:<userId>` 룸에 자동 join
 * - MailIdleManager가 새 메일 감지 시 해당 룸으로 이벤트 emit
 *
 * 발행 이벤트:
 *   'mail:new'        — 새 메일 도착 (최신 메시지 메타 포함)
 *   'mail:expunge'    — 메일 삭제됨 (uid)
 *   'mail:flags'      — flag 변경 (seen/flagged)
 *   'mail:idle-status' — IDLE 연결 상태 변화 (connected/disconnected/error)
 */
import { Server as SocketIOServer, type Namespace, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../config/logger';
import type { JwtPayload } from '../middleware/authenticate';

interface MailSocket extends Socket {
  data: { user: JwtPayload };
}

let mailNsp: Namespace | null = null;

export function setupMailSocket(io: SocketIOServer): Namespace {
  const mail = io.of('/mail');

  mail.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('UNAUTHORIZED'));
    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
      (socket as MailSocket).data.user = decoded;
      next();
    } catch (err) {
      logger.warn({ err }, 'Internal error');
      next(new Error('INVALID_TOKEN'));
    }
  });

  mail.on('connection', (socket: Socket) => {
    const typed = socket as MailSocket;
    const userId = typed.data.user.sub;
    typed.join(userRoom(userId));
    logger.debug({ userId }, '[mail-ws] client connected');

    typed.on('disconnect', () => {
      logger.debug({ userId }, '[mail-ws] client disconnected');
    });
  });

  mailNsp = mail;
  return mail;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** 새 메일 도착 알림 */
export function emitMailNew(userId: string, payload: {
  uid: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  sentAt: string;
  hasAttachment: boolean;
  folder: string;
}): void {
  if (!mailNsp) return;
  mailNsp.to(userRoom(userId)).emit('mail:new', payload);
}

/** 메일 삭제됨 */
export function emitMailExpunge(userId: string, uid: string, folder: string): void {
  if (!mailNsp) return;
  mailNsp.to(userRoom(userId)).emit('mail:expunge', { uid, folder });
}

/** flag 변경 */
export function emitMailFlags(userId: string, uid: string, folder: string, flags: { seen?: boolean; flagged?: boolean }): void {
  if (!mailNsp) return;
  mailNsp.to(userRoom(userId)).emit('mail:flags', { uid, folder, flags });
}

/** IDLE 연결 상태 */
export function emitIdleStatus(userId: string, status: 'connected' | 'disconnected' | 'error', message?: string): void {
  if (!mailNsp) return;
  mailNsp.to(userRoom(userId)).emit('mail:idle-status', { status, message });
}
