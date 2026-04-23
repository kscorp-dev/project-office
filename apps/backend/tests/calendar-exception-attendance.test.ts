/**
 * 캘린더 v0.21.0 확장 — 반복 예외 + 참석자 응답 DB 레벨 통합 테스트
 *
 * 커버:
 *   - CalendarEvent.exceptionDates 배열 기본값 / 업데이트
 *   - EventAttendee upsert (존재하면 update, 없으면 create)
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import prisma from '../src/config/prisma';
import { createTestUser } from './fixtures';

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let eventId: string;

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });

  const event = await prisma.calendarEvent.create({
    data: {
      title: '주간 회의',
      startDate: new Date('2026-05-04T09:00:00Z'),
      endDate: new Date('2026-05-04T10:00:00Z'),
      allDay: false,
      repeat: 'weekly',
      scope: 'personal',
      creatorId: alice.id,
    },
  });
  eventId = event.id;
});

afterAll(async () => {
  await prisma.eventAttendee.deleteMany({ where: { eventId } });
  await prisma.calendarEvent.deleteMany({ where: { id: eventId } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  await prisma.$disconnect();
});

describe('CalendarEvent.exceptionDates', () => {
  it('기본값은 빈 배열', async () => {
    const ev = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(ev?.exceptionDates).toEqual([]);
  });

  it('날짜를 추가하면 중복 없이 저장된다', async () => {
    const updated1 = await prisma.calendarEvent.update({
      where: { id: eventId },
      data: { exceptionDates: { set: ['2026-05-11'] } },
    });
    expect(updated1.exceptionDates).toEqual(['2026-05-11']);

    // 추가 1건 더
    const next = Array.from(new Set([...updated1.exceptionDates, '2026-05-18']));
    const updated2 = await prisma.calendarEvent.update({
      where: { id: eventId },
      data: { exceptionDates: { set: next } },
    });
    expect(updated2.exceptionDates).toEqual(['2026-05-11', '2026-05-18']);

    // 동일 날짜 재추가 시 Set으로 중복 제거
    const dedup = Array.from(new Set([...updated2.exceptionDates, '2026-05-18']));
    expect(dedup).toEqual(['2026-05-11', '2026-05-18']);
  });
});

describe('EventAttendee upsert flow', () => {
  it('참석자가 없으면 create', async () => {
    const created = await prisma.eventAttendee.create({
      data: { eventId, userId: bob.id, status: 'pending' },
    });
    expect(created.status).toBe('pending');
  });

  it('참석자가 있으면 update (accepted로 변경)', async () => {
    const existing = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId: bob.id } },
    });
    expect(existing).toBeTruthy();

    const updated = await prisma.eventAttendee.update({
      where: { id: existing!.id },
      data: { status: 'accepted' },
    });
    expect(updated.status).toBe('accepted');
  });

  it('다시 declined로 변경', async () => {
    const existing = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId: bob.id } },
    });
    const updated = await prisma.eventAttendee.update({
      where: { id: existing!.id },
      data: { status: 'declined' },
    });
    expect(updated.status).toBe('declined');
  });

  it('동일 이벤트에 두 명 참석자', async () => {
    const aliceAttendee = await prisma.eventAttendee.create({
      data: { eventId, userId: alice.id, status: 'accepted' },
    });
    expect(aliceAttendee.status).toBe('accepted');

    const all = await prisma.eventAttendee.findMany({ where: { eventId } });
    expect(all.length).toBe(2);
    const statuses = all.map((a) => a.status).sort();
    expect(statuses).toEqual(['accepted', 'declined']);
  });
});
