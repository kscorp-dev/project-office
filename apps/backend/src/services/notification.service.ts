/**
 * 통합 알림 서비스
 *
 * 전 모듈(결재·휴가·메신저·회의·게시판·작업 등)에서 호출할 유일한 진입점.
 * DB 저장 + WebSocket emit을 한 번에 수행하며, 여러 수신자에게 동시 발송도 지원.
 *
 * 사용 예:
 *   await createNotification({
 *     recipientId: approverUserId,
 *     actorId: drafterUserId,
 *     type: 'approval_pending',
 *     title: '결재 요청',
 *     body: `${drafterName} - ${docTitle}`,
 *     link: `/approval/documents/${docId}`,
 *     refType: 'approval',
 *     refId: docId,
 *   });
 */
import type { Prisma, NotificationType } from '@prisma/client';
import prisma from '../config/prisma';
import { emitNewNotification, emitUnreadCount } from '../websocket/notifications';
import { sendPushToUser } from './push.service';

export interface CreateNotificationInput {
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  refType?: string;
  refId?: string;
  meta?: Prisma.InputJsonValue;
}

/** 1인 대상 알림 생성 + WebSocket push */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  // 자기 자신에겐 알림 보내지 않음
  if (input.actorId && input.actorId === input.recipientId) return;

  const notification = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      refType: input.refType,
      refId: input.refId,
      meta: input.meta,
    },
    include: {
      actor: { select: { id: true, name: true, position: true } },
    },
  });

  // 실시간 WebSocket push (실패해도 DB는 보존)
  try {
    emitNewNotification(input.recipientId, notification);
    const unread = await countUnread(input.recipientId);
    emitUnreadCount(input.recipientId, unread);
  } catch { /* ignore — DB 저장은 성공 */ }

  // 모바일 FCM/APNs push (앱 미실행 상태에서 알림) — 비동기, 실패해도 무시
  sendPushToUser(input.recipientId, {
    title: input.title,
    body: input.body ?? '',
    data: {
      link: input.link,
      refType: input.refType,
      refId: input.refId,
      notificationId: notification.id,
      type: input.type,
    },
  }).catch((e) => {
    // 로그는 push.service 내부에서 처리
  });
}

/** 여러 수신자에게 동일 알림 벌크 생성 */
export async function createNotificationsBulk(
  recipientIds: string[],
  template: Omit<CreateNotificationInput, 'recipientId'>,
): Promise<void> {
  const distinct = Array.from(new Set(recipientIds)).filter(
    (id) => id && id !== template.actorId,
  );
  if (distinct.length === 0) return;

  await prisma.notification.createMany({
    data: distinct.map((rid) => ({
      recipientId: rid,
      actorId: template.actorId ?? null,
      type: template.type,
      title: template.title,
      body: template.body,
      link: template.link,
      refType: template.refType,
      refId: template.refId,
      meta: template.meta as Prisma.InputJsonValue | undefined,
    })),
  });

  // 각자에게 push — createMany는 id 반환 안 하므로 emit payload는 간단히
  for (const rid of distinct) {
    try {
      emitNewNotification(rid, {
        type: template.type,
        title: template.title,
        body: template.body,
        link: template.link,
        refType: template.refType,
        refId: template.refId,
      });
      const unread = await countUnread(rid);
      emitUnreadCount(rid, unread);
    } catch { /* ignore */ }
  }
}

/** 사용자의 읽지 않은 알림 갯수 */
export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { recipientId: userId, isRead: false },
  });
}

/** 알림 목록 조회 (페이지네이션) */
export async function listNotifications(
  userId: string,
  opts: { page?: number; limit?: number; unreadOnly?: boolean } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));

  const where: Prisma.NotificationWhereInput = {
    recipientId: userId,
    ...(opts.unreadOnly ? { isRead: false } : {}),
  };

  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { actor: { select: { id: true, name: true, position: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
  ]);

  return { rows, total, unread, page, limit };
}

/** 특정 알림을 읽음 처리 (소유자 검증 내장) */
export async function markAsRead(notificationId: string, userId: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, recipientId: userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  if (result.count > 0) {
    const unread = await countUnread(userId);
    try { emitUnreadCount(userId, unread); } catch { /* ignore */ }
    return true;
  }
  return false;
}

/** 모두 읽음 */
export async function markAllAsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { recipientId: userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  try { emitUnreadCount(userId, 0); } catch { /* ignore */ }
  return result.count;
}

/** 특정 refType/refId 관련 알림을 모두 삭제 (예: 결재 문서 삭제 시) */
export async function deleteByRef(refType: string, refId: string): Promise<number> {
  const result = await prisma.notification.deleteMany({
    where: { refType, refId },
  });
  return result.count;
}
