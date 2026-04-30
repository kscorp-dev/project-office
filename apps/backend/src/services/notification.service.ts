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
  // 모바일이 인식하는 단순화 type + categoryId (인라인 액션 버튼) 매핑
  const { mobileType, mobileExtra, categoryId } = mapToMobilePayload(input);
  sendPushToUser(input.recipientId, {
    title: input.title,
    body: input.body ?? '',
    categoryId,
    data: {
      // 모바일 hooks/usePushNotifications 가 우선 인식할 단순 타입
      type: mobileType,
      // 화면별 식별자 (id / roomId / uid)
      ...mobileExtra,
      // 호환용 원본 필드들도 유지
      link: input.link,
      refType: input.refType,
      refId: input.refId,
      notificationId: notification.id,
      originalType: input.type,
    },
  }).catch(() => {
    // 로그는 push.service 내부에서 처리
  });
}

/**
 * NotificationType (DB enum) → 모바일이 이해하는 단순 타입 + 인라인 액션 카테고리 매핑.
 * 모바일은 `data.type` 만 봐서 라우팅하므로, 여기서 한 번에 변환.
 *
 * 테스트에서 직접 호출 가능하게 export.
 */
export function mapToMobilePayload(input: CreateNotificationInput): {
  mobileType: string;
  mobileExtra: Record<string, string | undefined>;
  categoryId?: string;
} {
  const t = String(input.type);
  // 결재 도착·승인·반려·회수·참조 — 'approval' 로 통합
  if (t.startsWith('approval')) {
    return {
      mobileType: 'approval',
      mobileExtra: { id: input.refId },
      // pending 만 잠금화면 인라인 승인/반려 액션 노출 (처리된 건엔 무의미)
      categoryId: t === 'approval_pending' ? 'approval' : undefined,
    };
  }
  // 메신저: message_received / message_mention
  if (t === 'message_received' || t === 'message_mention') {
    return {
      mobileType: 'message',
      mobileExtra: { roomId: input.refId },
      categoryId: 'message',
    };
  }
  // 메일: mail_received (백엔드 enum 정확 명칭)
  if (t === 'mail_received') {
    return { mobileType: 'mail', mobileExtra: { uid: input.refId } };
  }
  // 회의: meeting_invited / meeting_starting_soon / meeting_minutes_ready
  if (t.startsWith('meeting')) {
    // ring 메타가 있으면 즉시 호출(VoIP 스타일) — CallKit/CallKeep 트리거용
    // hostName 포함 시 모바일 callkeep 화면에서 표시 가능하도록 평탄화
    const meta = (input.meta ?? {}) as Record<string, unknown>;
    const isRing = meta.ring === true;
    const hostName = typeof meta.hostName === 'string' ? meta.hostName : undefined;
    return {
      mobileType: 'meeting',
      mobileExtra: {
        id: input.refId,
        ring: isRing ? '1' : undefined,
        hostName,
      },
      // meeting_invited 만 인라인 [수락]/[거절] 버튼 활성화
      categoryId: t === 'meeting_invited' ? 'meeting' : undefined,
    };
  }
  // 작업지시서: task_assigned / task_status_changed
  if (t.startsWith('task_')) {
    return { mobileType: 'task', mobileExtra: { id: input.refId } };
  }
  // 휴가
  if (t.startsWith('vacation')) {
    return { mobileType: 'vacation', mobileExtra: { id: input.refId } };
  }
  // 게시판
  if (t.startsWith('post')) {
    return { mobileType: 'post', mobileExtra: { id: input.refId } };
  }
  // 기본: 원본 type 유지 — 모바일 측은 fallback 으로 link 사용
  return { mobileType: t, mobileExtra: { id: input.refId } };
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
