/**
 * 통합 알림 서비스 테스트
 *
 * 커버:
 *   - createNotification: 1인 생성, 본인 actor 자동 skip
 *   - createNotificationsBulk: 중복 제거, actor 제외
 *   - listNotifications: 페이지네이션 + unreadOnly
 *   - markAsRead: 소유자 검증, 이미 읽음 처리 시 false
 *   - markAllAsRead: 읽지 않은 것만 업데이트
 *   - countUnread: 정확 계산
 *
 * WebSocket emit은 tests 환경에서 notifNsp=null이라 no-op → emit 실패는 DB 저장 성공을
 * 해치지 않음이 보장됨.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import prisma from '../src/config/prisma';
import {
  createNotification,
  createNotificationsBulk,
  countUnread,
  listNotifications,
  markAsRead,
  markAllAsRead,
} from '../src/services/notification.service';
import { createTestUser } from './fixtures';

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let carol: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });
  carol = await createTestUser({ role: 'user' as any });
});

beforeEach(async () => {
  // 각 테스트 전에 기존 알림 제거 (다른 테스트의 부작용 방지)
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [alice.id, bob.id, carol.id] } },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [alice.id, bob.id, carol.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id] } } });
  await prisma.$disconnect();
});

describe('createNotification', () => {
  it('알림 1건 생성 + DB 저장 확인', async () => {
    await createNotification({
      recipientId: bob.id,
      actorId: alice.id,
      type: 'approval_pending',
      title: '결재 요청',
      body: '내용',
      link: '/approval/1',
      refType: 'approval',
      refId: 'doc-1',
    });
    const rows = await prisma.notification.findMany({ where: { recipientId: bob.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('approval_pending');
    expect(rows[0].title).toBe('결재 요청');
    expect(rows[0].isRead).toBe(false);
  });

  it('actor === recipient 인 경우 자동 skip', async () => {
    await createNotification({
      recipientId: alice.id,
      actorId: alice.id,
      type: 'approval_approved',
      title: '자신에게',
    });
    const count = await prisma.notification.count({ where: { recipientId: alice.id } });
    expect(count).toBe(0);
  });
});

describe('createNotificationsBulk', () => {
  it('여러 수신자에게 한 번에 생성, 중복 ID 제거', async () => {
    await createNotificationsBulk([bob.id, carol.id, bob.id], {
      actorId: alice.id,
      type: 'post_must_read',
      title: '필독 공지',
    });
    const bobCount = await prisma.notification.count({ where: { recipientId: bob.id } });
    const carolCount = await prisma.notification.count({ where: { recipientId: carol.id } });
    expect(bobCount).toBe(1);
    expect(carolCount).toBe(1);
  });

  it('actor 자신은 수신자 목록에서 제외', async () => {
    await createNotificationsBulk([alice.id, bob.id, carol.id], {
      actorId: alice.id,
      type: 'post_must_read',
      title: '전체 공지',
    });
    const aliceCount = await prisma.notification.count({ where: { recipientId: alice.id } });
    expect(aliceCount).toBe(0);
  });
});

describe('listNotifications / unread', () => {
  it('미확인만 필터링 + 페이지네이션', async () => {
    // 3개 생성 (bob → alice)
    await createNotification({ recipientId: alice.id, actorId: bob.id, type: 'system', title: 'A' });
    await createNotification({ recipientId: alice.id, actorId: bob.id, type: 'system', title: 'B' });
    await createNotification({ recipientId: alice.id, actorId: bob.id, type: 'system', title: 'C' });

    const all = await listNotifications(alice.id, { limit: 10 });
    expect(all.total).toBe(3);
    expect(all.unread).toBe(3);
    expect(all.rows).toHaveLength(3);

    // 1개 읽음 처리 → unread 2
    await markAsRead(all.rows[0].id, alice.id);
    const unreadOnly = await listNotifications(alice.id, { unreadOnly: true });
    expect(unreadOnly.total).toBe(2);
    expect(unreadOnly.unread).toBe(2);
    expect(unreadOnly.rows).toHaveLength(2);
  });

  it('markAsRead은 소유자가 아닐 경우 false', async () => {
    await createNotification({ recipientId: alice.id, actorId: bob.id, type: 'system', title: 'X' });
    const n = await prisma.notification.findFirst({ where: { recipientId: alice.id } });
    expect(n).not.toBeNull();

    const resultWrong = await markAsRead(n!.id, bob.id); // bob이 alice의 알림을 읽음 시도
    expect(resultWrong).toBe(false);

    const resultOk = await markAsRead(n!.id, alice.id);
    expect(resultOk).toBe(true);

    // 두번째 호출은 이미 읽음 → false
    const again = await markAsRead(n!.id, alice.id);
    expect(again).toBe(false);
  });

  it('markAllAsRead은 내 것만 업데이트', async () => {
    await createNotification({ recipientId: alice.id, actorId: bob.id, type: 'system', title: 'A' });
    await createNotification({ recipientId: alice.id, actorId: bob.id, type: 'system', title: 'B' });
    await createNotification({ recipientId: carol.id, actorId: bob.id, type: 'system', title: 'C' });

    const updated = await markAllAsRead(alice.id);
    expect(updated).toBe(2);

    expect(await countUnread(alice.id)).toBe(0);
    expect(await countUnread(carol.id)).toBe(1); // carol은 영향 없음
  });
});
