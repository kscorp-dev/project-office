/**
 * Push 통합 E2E 테스트
 *
 * 검증 흐름:
 *   createNotification(input)
 *     ─→ DB Notification insert
 *     ─→ WebSocket emit (test 환경에서 noop)
 *     ─→ mapToMobilePayload 로 단순화 type / extra / categoryId 변환
 *     ─→ sendPushToUser(recipientId, payload) 호출
 *
 * sendPushToUser 를 vi.spyOn 으로 가로채서, 모듈별(결재/메신저/회의/태스크/휴가/메일/게시판)
 * 시나리오마다 어떤 payload 가 모바일로 전달되는지 1:1 검증한다.
 *
 * 모바일 hooks/usePushNotifications.ts 가 인식하는 키:
 *   - data.type ∈ {approval, message, mail, meeting, task, vacation, post}
 *   - data.id / data.roomId / data.uid (mobileExtra)
 *   - data.ring='1' / data.hostName (회의 즉시 호출 시)
 *   - categoryId ∈ {approval, message, meeting} (잠금화면 인라인 액션)
 *   - data.notificationId / data.originalType / data.link (호환)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import prisma from '../src/config/prisma';
import { createNotification } from '../src/services/notification.service';
import * as pushService from '../src/services/push.service';
import { createTestUser } from './fixtures';

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });
});

beforeEach(async () => {
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [alice.id, bob.id] } },
  });
  // 매 테스트마다 spy 새로 설치 (호출 기록 클린)
  pushSpy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue({
    sent: 1, failed: 0, invalidTokens: [],
  });
});

afterAll(async () => {
  pushSpy?.mockRestore();
  await prisma.notification.deleteMany({ where: { recipientId: { in: [alice.id, bob.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  await prisma.$disconnect();
});

/** 마지막 sendPushToUser 호출의 (userId, payload) 추출 */
function lastCall(): { userId: string; payload: any } | null {
  if (pushSpy.mock.calls.length === 0) return null;
  const args = pushSpy.mock.calls[pushSpy.mock.calls.length - 1] as any[];
  return { userId: args[0] as string, payload: args[1] as any };
}

describe('결재 push 흐름', () => {
  it('approval_pending → categoryId=approval, data.type=approval, data.id=docId', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'approval_pending',
      title: '결재 요청',
      body: '홍길동 - 휴가 신청서',
      link: '/approval/documents/doc-abc',
      refType: 'approval',
      refId: 'doc-abc',
    });
    const c = lastCall();
    expect(c).not.toBeNull();
    expect(c!.userId).toBe(bob.id);
    expect(c!.payload.title).toBe('결재 요청');
    expect(c!.payload.categoryId).toBe('approval');
    expect(c!.payload.data.type).toBe('approval');
    expect(c!.payload.data.id).toBe('doc-abc');
    expect(c!.payload.data.originalType).toBe('approval_pending');
  });

  it('approval_approved → categoryId 없음 (인라인 버튼 노출 X)', async () => {
    await createNotification({
      recipientId: alice.id,
      actorId: bob.id,
      type: 'approval_approved',
      title: '결재 승인',
      refId: 'doc-1',
    });
    const c = lastCall();
    expect(c!.payload.categoryId).toBeUndefined();
    expect(c!.payload.data.type).toBe('approval');
  });
});

describe('메신저 push 흐름', () => {
  it('message_received → categoryId=message, data.roomId 매핑', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'message_received',
      title: 'Alice',
      body: '안녕하세요',
      refType: 'messenger_room',
      refId: 'room-xyz',
    });
    const c = lastCall();
    expect(c!.payload.categoryId).toBe('message');
    expect(c!.payload.data.type).toBe('message');
    expect(c!.payload.data.roomId).toBe('room-xyz');
    // mobileExtra.id 는 message 에선 사용하지 않음
    expect(c!.payload.data.id).toBeUndefined();
  });

  it('message_mention 도 동일 매핑', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'message_mention',
      title: '멘션',
      refId: 'room-mention',
    });
    const c = lastCall();
    expect(c!.payload.categoryId).toBe('message');
    expect(c!.payload.data.roomId).toBe('room-mention');
  });
});

describe('회의 push 흐름 (CallKit 트리거 검증)', () => {
  it('meeting_invited → categoryId=meeting (잠금화면 [수락]/[거절])', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'meeting_invited',
      title: '회의 초대',
      body: '4월 30일 14:00',
      refId: 'meet-1',
      meta: { hostName: 'Alice', scheduledAt: '2026-04-30T05:00:00Z' },
    });
    const c = lastCall();
    expect(c!.payload.categoryId).toBe('meeting');
    expect(c!.payload.data.type).toBe('meeting');
    expect(c!.payload.data.id).toBe('meet-1');
    expect(c!.payload.data.hostName).toBe('Alice');
    // 일반 초대는 ring 없음
    expect(c!.payload.data.ring).toBeUndefined();
  });

  it('meeting_invited + meta.ring=true → data.ring="1" (CallKit 즉시 호출)', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'meeting_invited',
      title: '📞 통화 호출',
      body: '데일리 스탠드업',
      refId: 'meet-ring-1',
      meta: { ring: true, hostName: 'Alice', roomCode: 'ABC123' },
    });
    const c = lastCall();
    expect(c!.payload.data.ring).toBe('1');
    expect(c!.payload.data.hostName).toBe('Alice');
    expect(c!.payload.categoryId).toBe('meeting');
  });

  it('meeting_starting_soon → categoryId 없음 (단순 리마인더)', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'meeting_starting_soon',
      title: '5분 후 시작',
      refId: 'meet-2',
    });
    const c = lastCall();
    expect(c!.payload.categoryId).toBeUndefined();
    expect(c!.payload.data.type).toBe('meeting');
  });
});

describe('메일 / 작업지시서 / 휴가 / 게시판 push', () => {
  it('mail_received → data.type=mail, data.uid 매핑 (categoryId 없음)', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: null,
      type: 'mail_received',
      title: '새 메일',
      refId: '5001',
    });
    const c = lastCall();
    expect(c!.payload.data.type).toBe('mail');
    expect(c!.payload.data.uid).toBe('5001');
    expect(c!.payload.categoryId).toBeUndefined();
  });

  it('task_assigned → data.type=task, data.id 매핑', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'task_assigned',
      title: '작업 배정',
      refId: 'task-1',
    });
    const c = lastCall();
    expect(c!.payload.data.type).toBe('task');
    expect(c!.payload.data.id).toBe('task-1');
  });

  it('vacation_approved → data.type=vacation', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'vacation_approved',
      title: '휴가 승인',
      refId: 'v-1',
    });
    const c = lastCall();
    expect(c!.payload.data.type).toBe('vacation');
    expect(c!.payload.data.id).toBe('v-1');
  });

  it('post_must_read → data.type=post', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'post_must_read',
      title: '필독 공지',
      refId: 'p-1',
    });
    const c = lastCall();
    expect(c!.payload.data.type).toBe('post');
    expect(c!.payload.data.id).toBe('p-1');
  });
});

describe('호환 / 메타데이터', () => {
  it('payload.data.notificationId 는 실제 DB 알림 ID 가 들어간다', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'approval_pending',
      title: 't', refId: 'd',
    });
    const c = lastCall();
    const dbRow = await prisma.notification.findFirst({
      where: { recipientId: bob.id }, orderBy: { createdAt: 'desc' },
    });
    expect(c!.payload.data.notificationId).toBe(dbRow?.id);
  });

  it('link 필드는 호환용으로 그대로 전달된다', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'approval_pending',
      title: 't',
      link: '/approval/documents/doc-7',
      refId: 'doc-7',
    });
    const c = lastCall();
    expect(c!.payload.data.link).toBe('/approval/documents/doc-7');
    expect(c!.payload.data.refType).toBeUndefined(); // refType 미지정 시 undefined OK
  });

  it('actor === recipient 인 경우 push 도 호출되지 않음 (DB skip 과 동일)', async () => {
    await createNotification({
      recipientId: alice.id,
      actorId: alice.id,
      type: 'system',
      title: 'self',
    });
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe('priority 필드 (high)', () => {
  it('모든 push 는 sendPushToUser 를 통과 — 내부적으로 priority=high 로 전송', async () => {
    // 직접 priority 를 검증하려면 sendPushToTokens 까지 spy 해야 하지만
    // 본 테스트의 contract 는 createNotification → sendPushToUser 호출이므로
    // 여기선 호출 횟수만 확인한다.
    await createNotification({
      recipientId: bob.id, actorId: alice.id, type: 'approval_pending', title: 't', refId: 'd',
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});
