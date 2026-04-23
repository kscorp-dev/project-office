/**
 * 화상회의 접근 권한 검증 통합 테스트
 *
 * 시나리오:
 *   - 호스트: 언제나 접근 가능
 *   - 초대받은 참가자(isInvited=true): 진행중/예정 상태면 join 가능, 조회는 항상
 *   - 참여 기록 있는 사람(joinedAt 있음): 종료 후에도 문서 조회 가능
 *   - 관련 없는 일반 사용자: 거부
 *   - 관리자: 언제나 허용
 *   - 취소된 회의: join 거부, 조회는 허용
 *   - 종료된 회의: join 거부 (NOT_ACTIVE), 참가 이력자는 조회 가능
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import prisma from '../src/config/prisma';
import { canJoinMeeting, canViewMeeting } from '../src/services/meeting.service';
import { createTestUser, uniqueId } from './fixtures';

let host: Awaited<ReturnType<typeof createTestUser>>;
let invited: Awaited<ReturnType<typeof createTestUser>>;
let joined: Awaited<ReturnType<typeof createTestUser>>;
let outsider: Awaited<ReturnType<typeof createTestUser>>;
let admin: Awaited<ReturnType<typeof createTestUser>>;

// 4개 상태의 회의 생성
let scheduledId: string;
let inProgressId: string;
let endedId: string;
let cancelledId: string;

const createdIds: string[] = [];

async function makeMeeting(
  title: string,
  status: 'scheduled' | 'in_progress' | 'ended' | 'cancelled',
  hostId: string,
) {
  const m = await prisma.meeting.create({
    data: {
      title,
      description: 'access-test',
      hostId,
      status,
      roomCode: uniqueId('RC').toUpperCase(),
      scheduledAt: new Date(),
      maxParticipants: 8,
    },
  });
  createdIds.push(m.id);
  return m;
}

async function attachParticipant(
  meetingId: string,
  userId: string,
  opts: { invited?: boolean; joined?: boolean; left?: boolean } = {},
) {
  await prisma.meetingParticipant.create({
    data: {
      meetingId,
      userId,
      role: 'participant',
      isInvited: opts.invited ?? false,
      joinedAt: opts.joined ? new Date() : null,
      leftAt: opts.left ? new Date() : null,
    },
  });
}

beforeAll(async () => {
  // 사용자 5명 (부서 없음 — meeting 권한 로직에 부서 무관)
  host = await createTestUser({ role: 'user' as any });
  invited = await createTestUser({ role: 'user' as any });
  joined = await createTestUser({ role: 'user' as any });
  outsider = await createTestUser({ role: 'user' as any });
  admin = await createTestUser({ role: 'admin' as any });

  // 4개 회의
  const s = await makeMeeting('예정', 'scheduled', host.id);
  const p = await makeMeeting('진행중', 'in_progress', host.id);
  const e = await makeMeeting('종료', 'ended', host.id);
  const c = await makeMeeting('취소', 'cancelled', host.id);
  scheduledId = s.id;
  inProgressId = p.id;
  endedId = e.id;
  cancelledId = c.id;

  // 참가자 배치: 모든 회의에 invited 초대, joined는 실제 참여 기록, outsider는 없음
  for (const mid of [scheduledId, inProgressId, endedId, cancelledId]) {
    await attachParticipant(mid, invited.id, { invited: true });
    await attachParticipant(mid, joined.id, { joined: true });
  }
});

afterAll(async () => {
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: createdIds } } });
  await prisma.meeting.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [host.id, invited.id, joined.id, outsider.id, admin.id] } } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────

describe('canJoinMeeting (실시간 참여 권한)', () => {
  it('호스트는 scheduled/in_progress 회의에 참여 가능', async () => {
    const r1 = await canJoinMeeting({ meetingId: scheduledId, userId: host.id, userRole: 'user' });
    expect(r1.ok).toBe(true);
    const r2 = await canJoinMeeting({ meetingId: inProgressId, userId: host.id, userRole: 'user' });
    expect(r2.ok).toBe(true);
  });

  it('초대받은 사람은 in_progress 회의에 참여 가능', async () => {
    const r = await canJoinMeeting({ meetingId: inProgressId, userId: invited.id, userRole: 'user' });
    expect(r.ok).toBe(true);
  });

  it('참여 기록이 있는 사람도 scheduled/in_progress에 참여 가능', async () => {
    const r = await canJoinMeeting({ meetingId: inProgressId, userId: joined.id, userRole: 'user' });
    expect(r.ok).toBe(true);
  });

  it('무관한 외부인은 거부', async () => {
    const r = await canJoinMeeting({ meetingId: inProgressId, userId: outsider.id, userRole: 'user' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('NOT_ALLOWED');
  });

  it('관리자는 외부인이어도 참여 가능', async () => {
    const r = await canJoinMeeting({ meetingId: inProgressId, userId: admin.id, userRole: 'admin' });
    expect(r.ok).toBe(true);
  });

  it('super_admin도 참여 가능', async () => {
    const r = await canJoinMeeting({ meetingId: inProgressId, userId: admin.id, userRole: 'super_admin' });
    expect(r.ok).toBe(true);
  });

  it('종료된 회의는 NOT_ACTIVE (호스트라도)', async () => {
    const r = await canJoinMeeting({ meetingId: endedId, userId: host.id, userRole: 'user' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('NOT_ACTIVE');
  });

  it('취소된 회의는 CANCELLED (호스트라도)', async () => {
    const r = await canJoinMeeting({ meetingId: cancelledId, userId: host.id, userRole: 'user' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('CANCELLED');
  });

  it('존재하지 않는 회의 ID → NOT_FOUND', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const r = await canJoinMeeting({ meetingId: fakeId, userId: host.id, userRole: 'user' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('NOT_FOUND');
  });
});

describe('canViewMeeting (문서 조회 권한)', () => {
  it('호스트는 모든 상태에서 조회 가능 (종료/취소 포함)', async () => {
    for (const mid of [scheduledId, inProgressId, endedId, cancelledId]) {
      const r = await canViewMeeting({ meetingId: mid, userId: host.id, userRole: 'user' });
      expect(r.ok).toBe(true);
    }
  });

  it('참여 기록 있는 사람은 종료된 회의도 조회 가능', async () => {
    const r = await canViewMeeting({ meetingId: endedId, userId: joined.id, userRole: 'user' });
    expect(r.ok).toBe(true);
  });

  it('초대된 참가자도 조회 가능', async () => {
    const r = await canViewMeeting({ meetingId: endedId, userId: invited.id, userRole: 'user' });
    expect(r.ok).toBe(true);
  });

  it('외부인은 모든 상태에서 조회 거부', async () => {
    for (const mid of [scheduledId, inProgressId, endedId, cancelledId]) {
      const r = await canViewMeeting({ meetingId: mid, userId: outsider.id, userRole: 'user' });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('NOT_ALLOWED');
    }
  });

  it('관리자는 무관한 회의도 조회 가능', async () => {
    const r = await canViewMeeting({ meetingId: endedId, userId: admin.id, userRole: 'admin' });
    expect(r.ok).toBe(true);
  });

  it('존재하지 않는 회의 ID → NOT_FOUND', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const r = await canViewMeeting({ meetingId: fakeId, userId: host.id, userRole: 'user' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('NOT_FOUND');
  });
});
