/**
 * 캘린더 외부 동기화 통합 테스트
 *
 * 커버:
 *   - 구독 생성 / 목록 / 업데이트 / 회전 / 폐기 흐름
 *   - scope=personal/personal_dept/all 데이터 필터
 *   - ICS 출력이 RFC 5545 최소 필드 포함하는지
 *   - VALARM 블록이 reminderMinutes 수만큼 생성되는지
 *   - findSubscriptionByToken이 revoked/inactive 경우 null 반환
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import prisma from '../src/config/prisma';
import {
  createSubscription,
  listSubscriptionsForUser,
  updateSubscription,
  revokeSubscription,
  regenerateSubscriptionToken,
  findSubscriptionByToken,
  renderIcsForSubscription,
} from '../src/services/calendar-sync.service';
import { createTestUser } from './fixtures';

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;

let aliceEventId: string;

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });

  // alice의 개인 일정 1건
  const event = await prisma.calendarEvent.create({
    data: {
      title: '개인 회의',
      description: '설명',
      startDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3600 * 1000),
      allDay: false,
      scope: 'personal',
      creatorId: alice.id,
    },
  });
  aliceEventId = event.id;
});

beforeEach(async () => {
  // 테스트마다 구독 정리 (MAX_SUBSCRIPTIONS 한도 방지)
  await prisma.calendarSubscription.deleteMany({
    where: { userId: { in: [alice.id, bob.id] } },
  });
});

afterAll(async () => {
  await prisma.calendarSubscription.deleteMany({
    where: { userId: { in: [alice.id, bob.id] } },
  });
  await prisma.calendarEvent.deleteMany({
    where: { creatorId: { in: [alice.id, bob.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  await prisma.$disconnect();
});

describe('CalendarSubscription CRUD', () => {
  it('구독 생성 + 토큰 자동 생성', async () => {
    const sub = await createSubscription({
      userId: alice.id,
      name: '내 iPhone',
      scope: 'personal',
      reminderMinutes: [10, 30],
    });
    expect(sub.token).toHaveLength(43); // 32 bytes → base64url 43자
    expect(sub.reminderMinutes).toEqual([10, 30]);
    expect(sub.isActive).toBe(true);
  });

  it('목록 조회 시 폐기된 것은 제외', async () => {
    const s = await createSubscription({ userId: alice.id, name: '제거예정' });
    await revokeSubscription(s.id, alice.id);

    const list = await listSubscriptionsForUser(alice.id);
    expect(list.find((x) => x.id === s.id)).toBeUndefined();
  });

  it('updateSubscription으로 옵션 변경', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'tmp' });
    const updated = await updateSubscription(s.id, alice.id, {
      name: 'renamed',
      reminderMinutes: [5, 60],
    });
    expect(updated.name).toBe('renamed');
    expect(updated.reminderMinutes).toEqual([5, 60]);
  });

  it('남의 구독은 update 불가 (NOT_FOUND)', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'alice tmp' });
    await expect(
      updateSubscription(s.id, bob.id, { name: 'hacked' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('regenerate는 토큰 새로 발급', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'rotatable' });
    const oldToken = s.token;
    const rotated = await regenerateSubscriptionToken(s.id, alice.id);
    expect(rotated.token).not.toBe(oldToken);
    expect(rotated.token).toHaveLength(43);
  });

  it('reminderMinutes sanitize — 중복 제거, 범위 밖 제거, 최대 5개', async () => {
    const s = await createSubscription({
      userId: alice.id,
      name: 'sanitize',
      reminderMinutes: [10, 10, -5, 2000, 30, 60, 90, 120, 180], // 중복 / 음수 / 1440 초과
    });
    expect(s.reminderMinutes.length).toBeLessThanOrEqual(5);
    expect(s.reminderMinutes.every((n) => n >= 0 && n <= 1440)).toBe(true);
  });

  it('10개 초과 구독 시 에러', async () => {
    // 기존 목록 비움
    await prisma.calendarSubscription.deleteMany({ where: { userId: bob.id } });
    for (let i = 0; i < 10; i++) {
      await createSubscription({ userId: bob.id, name: `sub-${i}` });
    }
    await expect(
      createSubscription({ userId: bob.id, name: 'overflow' }),
    ).rejects.toMatchObject({ code: 'MAX_SUBSCRIPTIONS' });
  });
});

describe('findSubscriptionByToken', () => {
  it('정상 토큰 조회', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'feed-test' });
    const found = await findSubscriptionByToken(s.token);
    expect(found?.id).toBe(s.id);
    expect(found?.user.id).toBe(alice.id);
  });

  it('폐기된 토큰은 null', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'to-revoke' });
    await revokeSubscription(s.id, alice.id);
    const found = await findSubscriptionByToken(s.token);
    expect(found).toBeNull();
  });

  it('isActive=false 인 토큰은 null', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'toggleable' });
    await updateSubscription(s.id, alice.id, { isActive: false });
    const found = await findSubscriptionByToken(s.token);
    expect(found).toBeNull();
  });

  it('존재하지 않는 토큰은 null', async () => {
    const found = await findSubscriptionByToken('invalid-token-xxx');
    expect(found).toBeNull();
  });
});

describe('renderIcsForSubscription', () => {
  it('기본 ICS 구조 (BEGIN:VCALENDAR ... END:VCALENDAR)', async () => {
    const s = await createSubscription({ userId: alice.id, name: 'render-test' });
    const { ics, etag } = await renderIcsForSubscription(s.id);

    expect(ics).toMatch(/^BEGIN:VCALENDAR/m);
    expect(ics).toMatch(/END:VCALENDAR/m);
    expect(ics).toMatch(/PRODID:/); // 어떤 형식이든 PRODID 있어야 함
    expect(ics).toMatch(/Asia\/Seoul/);
    expect(etag).toMatch(/^[0-9a-f]{32}$/); // md5
  });

  it('alice의 personal 이벤트가 포함됨', async () => {
    const s = await createSubscription({
      userId: alice.id,
      name: 'event-include',
      scope: 'personal',
      reminderMinutes: [10],
    });
    const { ics } = await renderIcsForSubscription(s.id);
    expect(ics).toContain('개인 회의');
    expect(ics).toContain(`event-${aliceEventId}@project-office`);
  });

  it('VALARM 블록이 reminderMinutes 수만큼 생성', async () => {
    const s = await createSubscription({
      userId: alice.id,
      name: 'alarms',
      reminderMinutes: [5, 10, 30],
    });
    const { ics } = await renderIcsForSubscription(s.id);
    const alarmCount = (ics.match(/BEGIN:VALARM/g) || []).length;
    // alice의 이벤트 1개 × 알람 3개 = 3
    expect(alarmCount).toBeGreaterThanOrEqual(3);
  });

  it('scope=personal인 경우 타인 이벤트 제외', async () => {
    const bobEvent = await prisma.calendarEvent.create({
      data: {
        title: 'bob만의 일정',
        startDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        endDate: new Date(Date.now() + 2 * 24 * 3600 * 1000 + 3600 * 1000),
        allDay: false,
        scope: 'personal',
        creatorId: bob.id,
      },
    });
    const aliceSub = await createSubscription({
      userId: alice.id,
      name: 'scope-personal',
      scope: 'personal',
    });
    const { ics } = await renderIcsForSubscription(aliceSub.id);
    expect(ics).not.toContain('bob만의 일정');
    await prisma.calendarEvent.delete({ where: { id: bobEvent.id } });
  });

  it('etag는 내용이 바뀌면 달라짐', async () => {
    const s = await createSubscription({
      userId: alice.id,
      name: 'etag-test',
      reminderMinutes: [10],
    });
    const first = await renderIcsForSubscription(s.id);

    // 알림 시간 변경 → VALARM trigger 달라짐 → etag 변경
    await updateSubscription(s.id, alice.id, { reminderMinutes: [60] });
    const second = await renderIcsForSubscription(s.id);

    expect(second.etag).not.toBe(first.etag);
  });
});
