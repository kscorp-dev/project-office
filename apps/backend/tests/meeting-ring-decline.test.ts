/**
 * POST /meeting/:id/ring + /decline 라우트 통합 테스트
 *
 * 검증:
 *   - /ring: 호스트만 호출 가능, 참가자 수만큼 createNotification 발사
 *   - /ring 알림은 meta.ring=true 포함 → mapToMobilePayload 가 ring='1' 으로 평탄화
 *   - /decline: 참가자가 호스트에게 거절 알림 1건 생성
 *   - /decline: 호스트 자신이 호출 시 알림 미발사 (자기-스킵)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import meetingRoutes from '../src/routes/meeting.routes';
import { config } from '../src/config';
import { createTestUser, uniqueId } from './fixtures';

const app = express();
app.use(express.json());
app.use('/meeting', meetingRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let host: Awaited<ReturnType<typeof createTestUser>>;
let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let outsider: Awaited<ReturnType<typeof createTestUser>>;
let meetingId: string;

beforeAll(async () => {
  host = await createTestUser({ role: 'user' as any });
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });
  outsider = await createTestUser({ role: 'user' as any });

  const meeting = await prisma.meeting.create({
    data: {
      title: 'Ring 테스트 회의',
      description: 'ring/decline 테스트',
      hostId: host.id,
      status: 'in_progress',
      roomCode: uniqueId('RC').toUpperCase(),
      scheduledAt: new Date(),
      maxParticipants: 8,
      participants: {
        create: [
          { userId: host.id, role: 'host', isInvited: true },
          { userId: alice.id, role: 'participant', isInvited: true },
          { userId: bob.id, role: 'participant', isInvited: true },
        ],
      },
    },
  });
  meetingId = meeting.id;
});

beforeEach(async () => {
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [host.id, alice.id, bob.id, outsider.id] } },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [host.id, alice.id, bob.id, outsider.id] } },
  });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId } });
  await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => { /* already gone */ });
  await prisma.user.deleteMany({
    where: { id: { in: [host.id, alice.id, bob.id, outsider.id] } },
  });
  await prisma.$disconnect();
});

describe('POST /meeting/:id/ring', () => {
  it('호스트가 호출 → 200 + ringedCount=2 (호스트 제외 참가자만)', async () => {
    const res = await request(app)
      .post(`/meeting/${meetingId}/ring`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ringedCount).toBe(2);

    // 알림 검증 — Alice/Bob 만 받음, host 자신은 안 받음
    const aliceNotifs = await prisma.notification.findMany({ where: { recipientId: alice.id } });
    const bobNotifs = await prisma.notification.findMany({ where: { recipientId: bob.id } });
    const hostNotifs = await prisma.notification.findMany({ where: { recipientId: host.id } });
    expect(aliceNotifs).toHaveLength(1);
    expect(bobNotifs).toHaveLength(1);
    expect(hostNotifs).toHaveLength(0);

    // meta.ring=true / meta.hostName 포함 검증
    const meta = aliceNotifs[0].meta as Record<string, unknown> | null;
    expect(meta?.ring).toBe(true);
    expect(typeof meta?.hostName).toBe('string');
    expect(aliceNotifs[0].type).toBe('meeting_invited');
    expect(aliceNotifs[0].title).toContain('통화 호출');
  });

  it('참가자(비호스트) 호출 → 403', async () => {
    const res = await request(app)
      .post(`/meeting/${meetingId}/ring`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('존재하지 않는 회의 → 404', async () => {
    const res = await request(app)
      .post(`/meeting/00000000-0000-0000-0000-000000000000/ring`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(res.status).toBe(404);
  });

  it('인증 없음 → 401', async () => {
    const res = await request(app).post(`/meeting/${meetingId}/ring`);
    expect(res.status).toBe(401);
  });
});

describe('POST /meeting/:id/decline', () => {
  it('참가자가 거절 → 200 + 호스트에게 거절 알림', async () => {
    const res = await request(app)
      .post(`/meeting/${meetingId}/decline`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.status).toBe(200);

    const hostNotifs = await prisma.notification.findMany({
      where: { recipientId: host.id, refId: meetingId },
    });
    expect(hostNotifs).toHaveLength(1);
    expect(hostNotifs[0].title).toBe('통화 거절');
    expect(hostNotifs[0].body).toContain('거절했습니다');
    const meta = hostNotifs[0].meta as Record<string, unknown> | null;
    expect(meta?.declined).toBe(true);
  });

  it('호스트 자신이 호출 → 200 + 자기 자신에게는 알림 X', async () => {
    const res = await request(app)
      .post(`/meeting/${meetingId}/decline`)
      .set('Authorization', `Bearer ${tokenFor(host)}`);
    expect(res.status).toBe(200);

    const hostNotifs = await prisma.notification.findMany({
      where: { recipientId: host.id, refId: meetingId },
    });
    expect(hostNotifs).toHaveLength(0);
  });

  it('존재하지 않는 회의 → 404', async () => {
    const res = await request(app)
      .post(`/meeting/00000000-0000-0000-0000-000000000000/decline`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.status).toBe(404);
  });

  it('회의 참가자 아닌 외부인이 decline 시도 → 403 (2차 감사 C2)', async () => {
    const res = await request(app)
      .post(`/meeting/${meetingId}/decline`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    // 호스트에게 알림 안 갔는지 확인 (스팸 차단)
    const notifs = await prisma.notification.findMany({
      where: { recipientId: host.id, refId: meetingId },
    });
    expect(notifs).toHaveLength(0);
  });
});
