/**
 * GET /api/dashboard/summary 라우트 테스트
 *
 * 카드 7종이 정확한 카운트를 반환하는지 + 자기 데이터만 보이는지 + 위임 받은 결재가 합산되는지.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import dashboardRoutes from '../src/routes/dashboard.routes';
import { config } from '../src/config';
import { createTestUser, uniqueId } from './fixtures';

const app = express();
app.use(express.json());
app.use('/dashboard', dashboardRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let docId: string;
const cleanupNotifIds: string[] = [];

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });

  // 결재 1건 — alice 가 1단계 결재자
  const tpl = await prisma.approvalTemplate.create({
    data: { name: 'dashboard-tpl', code: uniqueId('TPL').toUpperCase(), category: 'test', sortOrder: 0 },
  });
  const doc = await prisma.approvalDocument.create({
    data: {
      docNumber: uniqueId('DASH'),
      templateId: tpl.id,
      drafterId: bob.id,
      title: '대시보드 테스트',
      content: '본문',
      status: 'pending',
      currentStep: 1,
      submittedAt: new Date(),
      lines: {
        create: [
          { step: 1, approverId: alice.id, type: 'serial', status: 'pending' },
        ],
      },
    },
  });
  docId = doc.id;

  // 알림 2건 (1 unread, 1 read)
  const n1 = await prisma.notification.create({
    data: { recipientId: alice.id, type: 'approval_pending', title: 'a', isRead: false },
  });
  const n2 = await prisma.notification.create({
    data: { recipientId: alice.id, type: 'approval_pending', title: 'b', isRead: true, readAt: new Date() },
  });
  cleanupNotifIds.push(n1.id, n2.id);
});

afterAll(async () => {
  await prisma.approvalLine.deleteMany({ where: { documentId: docId } });
  await prisma.approvalDocument.delete({ where: { id: docId } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { id: { in: cleanupNotifIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  await prisma.$disconnect();
});

describe('GET /dashboard/summary', () => {
  it('인증 없이 호출 → 401', async () => {
    const res = await request(app).get('/dashboard/summary');
    expect(res.status).toBe(401);
  });

  it('alice (1단계 결재자) → pendingApprovals=1, unreadNotifications=1', async () => {
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.pendingApprovals).toBe(1);
    expect(d.unreadNotifications).toBe(1);
    expect(d.unreadMessages).toBe(0);
    expect(d.delegatedPendingApprovals).toBe(0);
    expect(d.attendance.checkedIn).toBe(false);
    expect(Array.isArray(d.delegations)).toBe(true);
    expect(d.delegations).toHaveLength(0);
  });

  it('bob (drafter) → pendingApprovals=0 (자기 결재 차례 아님)', async () => {
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${tokenFor(bob)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.pendingApprovals).toBe(0);
    expect(res.body.data.unreadNotifications).toBe(0);
  });

  it('체크인 후 attendance.checkedIn=true', async () => {
    const att = await prisma.attendance.create({
      data: { userId: alice.id, type: 'check_in', checkTime: new Date() },
    });
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.body.data.attendance.checkedIn).toBe(true);
    expect(res.body.data.attendance.checkInAt).toBeTruthy();
    await prisma.attendance.delete({ where: { id: att.id } });
  });

  it('alice → bob 위임 활성 시 bob 의 응답에 delegations 포함 + 합산', async () => {
    // bob 이 alice 의 결재를 위임받음
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 86400_000);
    const dlg = await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: start,
        endDate: end,
        isActive: true,
      },
    });

    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${tokenFor(bob)}`);
    expect(res.body.data.delegations).toHaveLength(1);
    expect(res.body.data.delegations[0].fromUserId).toBe(alice.id);
    // alice 가 1단계 결재자인 doc 1건 → bob 의 delegatedPendingApprovals=1
    expect(res.body.data.delegatedPendingApprovals).toBe(1);

    await prisma.approvalDelegation.delete({ where: { id: dlg.id } });
  });

  it('비활성 위임은 무시', async () => {
    const dlg = await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 86400_000),
        isActive: false, // 비활성
      },
    });
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${tokenFor(bob)}`);
    expect(res.body.data.delegations).toHaveLength(0);
    expect(res.body.data.delegatedPendingApprovals).toBe(0);
    await prisma.approvalDelegation.delete({ where: { id: dlg.id } });
  });

  it('만료된 위임도 무시', async () => {
    const dlg = await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(Date.now() - 86400_000 * 30),
        endDate: new Date(Date.now() - 86400_000 * 10),
        isActive: true, // 활성이지만 endDate 지남
      },
    });
    const res = await request(app)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${tokenFor(bob)}`);
    expect(res.body.data.delegations).toHaveLength(0);
    await prisma.approvalDelegation.delete({ where: { id: dlg.id } });
  });
});
