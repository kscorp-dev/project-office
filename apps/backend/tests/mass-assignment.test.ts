/**
 * Mass assignment 방어 회귀 테스트 (4차 감사 Critical 1-3 + High 4)
 *
 * 4차 감사로 발견된 PATCH 라우트들이 클라이언트가 임의 필드를 보내도
 * sensitive 필드(creatorId / hostId / id / createdAt 등)를 변경할 수 없는지 검증.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import calendarRoutes from '../src/routes/calendar.routes';
import meetingRoutes from '../src/routes/meeting.routes';
import taskOrderRoutes from '../src/routes/task-orders.routes';
import { config } from '../src/config';
import { createTestUser, uniqueId } from './fixtures';

const app = express();
app.use(express.json());
app.use('/calendar', calendarRoutes);
app.use('/meeting', meetingRoutes);
app.use('/task-orders', taskOrderRoutes);

function tokenFor(u: { id: string; role: string }) {
  return jwt.sign({ sub: u.id, role: u.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let eventId: string;
let meetingId: string;
let taskId: string;
const moduleInitial: Record<string, boolean> = {};

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });

  // 모듈 활성화 (test 환경에서 일부 모듈 비활성 default 가능)
  for (const name of ['calendar', 'meeting', 'task_orders']) {
    const mod = await prisma.featureModule.findUnique({ where: { name } });
    if (mod) {
      moduleInitial[name] = mod.isEnabled;
      if (!mod.isEnabled) {
        await prisma.featureModule.update({ where: { id: mod.id }, data: { isEnabled: true } });
      }
    }
  }

  // alice 가 만든 personal 일정
  const ev = await prisma.calendarEvent.create({
    data: {
      title: '원래 제목',
      startDate: new Date(Date.now() + 3600_000),
      endDate: new Date(Date.now() + 7200_000),
      creatorId: alice.id,
      scope: 'personal',
    },
  });
  eventId = ev.id;

  // alice 가 호스트인 회의
  const m = await prisma.meeting.create({
    data: {
      title: '원래 회의',
      hostId: alice.id,
      status: 'scheduled',
      roomCode: uniqueId('RC').toUpperCase(),
      scheduledAt: new Date(),
      maxParticipants: 8,
      participants: { create: [{ userId: alice.id, role: 'host' }] },
    },
  });
  meetingId = m.id;

  // alice 가 만든 작업지시서
  const t = await prisma.taskOrder.create({
    data: {
      taskNumber: uniqueId('TASK'),
      title: '원래 작업',
      creatorId: alice.id,
      status: 'draft',
    },
  });
  taskId = t.id;
});

afterAll(async () => {
  await prisma.calendarEvent.deleteMany({ where: { id: eventId } }).catch(() => {});
  await prisma.meetingParticipant.deleteMany({ where: { meetingId } }).catch(() => {});
  await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => {});
  await prisma.taskOrder.delete({ where: { id: taskId } }).catch(() => {});
  // 모듈 상태 복원
  for (const [name, was] of Object.entries(moduleInitial)) {
    await prisma.featureModule.update({ where: { name }, data: { isEnabled: was } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  await prisma.$disconnect();
});

describe('Calendar PATCH /events/:id mass assignment 방어 (4차 C1)', () => {
  it('일반 사용자가 scope=company 격상 시도 → 403 (관리자만 가능)', async () => {
    const res = await request(app)
      .patch(`/calendar/events/${eventId}`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ scope: 'company' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('전사');

    const reloaded = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(reloaded?.scope).toBe('personal'); // 차단됨
  });

  it('creatorId / id / createdAt 임의 변경 시도 → 본문은 변경되되 sensitive 필드는 무시', async () => {
    const res = await request(app)
      .patch(`/calendar/events/${eventId}`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({
        title: '제목 변경',
        creatorId: bob.id,        // 시도1: 일정 소유자 변경
        id: 'malicious-id',       // 시도2: PK 변경
        createdAt: new Date(0).toISOString(), // 시도3: 작성일 조작
      });
    expect(res.status).toBe(200);

    const reloaded = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(reloaded?.title).toBe('제목 변경'); // 정상 변경
    expect(reloaded?.creatorId).toBe(alice.id); // 차단
    expect(reloaded?.id).toBe(eventId); // 변경 안됨
  });
});

describe('Meeting PATCH /:id mass assignment 방어 (4차 C3)', () => {
  it('hostId 이전 / roomCode 변경 시도 → 무시', async () => {
    const originalRoomCode = (await prisma.meeting.findUnique({ where: { id: meetingId } }))?.roomCode;
    const res = await request(app)
      .patch(`/meeting/${meetingId}`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({
        title: '회의 제목 변경',
        hostId: bob.id,           // 시도1: 호스트 이전 (소유권 탈취)
        roomCode: 'HACKED',       // 시도2: 룸코드 변경 (unique 충돌)
        status: 'ended',          // 시도3: 상태 강제 종료
      });
    expect(res.status).toBe(200);

    const reloaded = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(reloaded?.title).toBe('회의 제목 변경'); // 정상
    expect(reloaded?.hostId).toBe(alice.id); // 차단
    expect(reloaded?.roomCode).toBe(originalRoomCode); // 차단
    expect(reloaded?.status).toBe('scheduled'); // status 별도 라우트 (start/end/cancel)
  });
});

describe('TaskOrder PATCH /:id mass assignment 방어 (4차 C2)', () => {
  it('status 우회 / creatorId / taskNumber 변경 시도 → 무시', async () => {
    const original = await prisma.taskOrder.findUnique({ where: { id: taskId } });
    const res = await request(app)
      .patch(`/task-orders/${taskId}`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({
        title: '작업 제목 변경',
        creatorId: bob.id,           // 시도1: 작성자 변경
        taskNumber: 'HACKED-001',    // 시도2: 고유 식별자 변경
        // status 는 현재 화이트리스트에 포함되어 있어 변경 가능 (workflow 검증은 별도 endpoint)
      });
    expect(res.status).toBe(200);

    const reloaded = await prisma.taskOrder.findUnique({ where: { id: taskId } });
    expect(reloaded?.title).toBe('작업 제목 변경');
    expect(reloaded?.creatorId).toBe(alice.id); // 차단
    expect(reloaded?.taskNumber).toBe(original?.taskNumber); // 차단
  });
});
