/**
 * 결재 위임/대결 통합 테스트
 *
 * 시나리오:
 *   - 위임 생성 (자기 자신 차단 / endDate < startDate 차단 / 과거 차단)
 *   - 위임 목록 (outgoing/incoming 분리)
 *   - 위임 취소 (본인 / admin / 타인 403)
 *   - 결재 승인 시 위임자 권한으로 처리 가능 + line.actedByUserId 기록
 *   - 결재 반려도 동일 동작
 *   - 비활성/만료 위임은 사용 불가
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import delegationRoutes from '../src/routes/delegation.routes';
import approvalRoutes from '../src/routes/approval.routes';
import { config } from '../src/config';
import { ApprovalService } from '../src/services/approval.service';
import { createTestUser, uniqueId } from './fixtures';

const app = express();
app.use(express.json());
app.use('/approvals/delegations', delegationRoutes);
app.use('/approvals', approvalRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let carol: Awaited<ReturnType<typeof createTestUser>>;
let admin: Awaited<ReturnType<typeof createTestUser>>;
let templateId: string;
const docIds: string[] = [];
const dlgIds: string[] = [];

beforeAll(async () => {
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });
  carol = await createTestUser({ role: 'user' as any });
  admin = await createTestUser({ role: 'admin' as any });

  const tpl = await prisma.approvalTemplate.create({
    data: {
      name: 'delegation-test',
      code: uniqueId('DLG').toUpperCase(),
      category: 'test',
      sortOrder: 0,
    },
  });
  templateId = tpl.id;
});

beforeEach(async () => {
  // 각 테스트 전 위임 모두 정리
  await prisma.approvalDelegation.deleteMany({
    where: { OR: [
      { fromUserId: { in: [alice.id, bob.id, carol.id] } },
      { toUserId: { in: [alice.id, bob.id, carol.id] } },
    ] },
  });
  dlgIds.length = 0;
});

afterAll(async () => {
  await prisma.approvalLine.deleteMany({ where: { documentId: { in: docIds } } });
  await prisma.approvalDocument.deleteMany({ where: { id: { in: docIds } } });
  await prisma.approvalDelegation.deleteMany({
    where: { OR: [
      { fromUserId: { in: [alice.id, bob.id, carol.id] } },
      { toUserId: { in: [alice.id, bob.id, carol.id] } },
    ] },
  });
  await prisma.approvalTemplate.delete({ where: { id: templateId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id, admin.id] } } });
  await prisma.$disconnect();
});

describe('POST /approvals/delegations', () => {
  it('정상 생성 → 201', async () => {
    const start = new Date(Date.now() + 60_000).toISOString();
    const end = new Date(Date.now() + 86400_000).toISOString();
    const res = await request(app)
      .post('/approvals/delegations')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({ toUserId: bob.id, startDate: start, endDate: end, reason: '휴가' });
    expect(res.status).toBe(201);
    expect(res.body.data.toUser.id).toBe(bob.id);
    expect(res.body.data.fromUserId).toBe(alice.id);
    dlgIds.push(res.body.data.id);
  });

  it('자기 자신에게 위임 → 400 INVALID_TARGET', async () => {
    const res = await request(app)
      .post('/approvals/delegations')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({
        toUserId: alice.id,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86400_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TARGET');
  });

  it('endDate <= startDate → 400', async () => {
    const res = await request(app)
      .post('/approvals/delegations')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({
        toUserId: bob.id,
        startDate: new Date(Date.now() + 86400_000).toISOString(),
        endDate: new Date(Date.now() + 3600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RANGE');
  });

  it('이미 지난 기간 → 400 PAST_RANGE', async () => {
    const res = await request(app)
      .post('/approvals/delegations')
      .set('Authorization', `Bearer ${tokenFor(alice)}`)
      .send({
        toUserId: bob.id,
        startDate: new Date(Date.now() - 86400_000 * 10).toISOString(),
        endDate: new Date(Date.now() - 86400_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAST_RANGE');
  });
});

describe('GET /approvals/delegations', () => {
  it('outgoing/incoming 분리되어 응답', async () => {
    // alice → bob
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 86400_000);
    const dlg = await prisma.approvalDelegation.create({
      data: { fromUserId: alice.id, toUserId: bob.id, startDate: start, endDate: end, isActive: true },
    });
    dlgIds.push(dlg.id);

    const aliceRes = await request(app)
      .get('/approvals/delegations')
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(aliceRes.body.data.outgoing).toHaveLength(1);
    expect(aliceRes.body.data.incoming).toHaveLength(0);

    const bobRes = await request(app)
      .get('/approvals/delegations')
      .set('Authorization', `Bearer ${tokenFor(bob)}`);
    expect(bobRes.body.data.outgoing).toHaveLength(0);
    expect(bobRes.body.data.incoming).toHaveLength(1);
    expect(bobRes.body.data.incoming[0].fromUser.id).toBe(alice.id);
  });
});

describe('DELETE /approvals/delegations/:id', () => {
  it('본인 취소 → 200, isActive=false', async () => {
    const dlg = await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        isActive: true,
      },
    });
    const res = await request(app)
      .delete(`/approvals/delegations/${dlg.id}`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.status).toBe(200);
    const reloaded = await prisma.approvalDelegation.findUnique({ where: { id: dlg.id } });
    expect(reloaded?.isActive).toBe(false);
  });

  it('타인이 취소 → 403', async () => {
    const dlg = await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        isActive: true,
      },
    });
    dlgIds.push(dlg.id);
    const res = await request(app)
      .delete(`/approvals/delegations/${dlg.id}`)
      .set('Authorization', `Bearer ${tokenFor(carol)}`);
    expect(res.status).toBe(403);
  });

  it('admin 은 타인 위임도 취소 가능', async () => {
    const dlg = await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        isActive: true,
      },
    });
    const res = await request(app)
      .delete(`/approvals/delegations/${dlg.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });
});

describe('결재 승인 — 위임 권한 적용', () => {
  async function makeDoc(approverId: string) {
    const doc = await prisma.approvalDocument.create({
      data: {
        docNumber: uniqueId('DLGD'),
        templateId,
        drafterId: carol.id, // alice/bob 가 결재자, drafter는 carol
        title: '위임 테스트',
        content: '본문',
        status: 'pending',
        currentStep: 1,
        submittedAt: new Date(),
        lines: { create: [{ step: 1, approverId, type: 'serial', status: 'pending' }] },
      },
    });
    docIds.push(doc.id);
    return doc;
  }

  it('alice → bob 위임 활성 시 bob 이 alice 의 결재를 처리 가능 + actedByUserId=bob', async () => {
    await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 86400_000),
        isActive: true,
      },
    });
    const doc = await makeDoc(alice.id);
    const svc = new ApprovalService();

    await svc.approve(doc.id, bob.id, '대결 처리');

    const reloaded = await prisma.approvalDocument.findUnique({
      where: { id: doc.id },
      include: { lines: true },
    });
    expect(reloaded?.status).toBe('approved');
    const line = reloaded!.lines[0];
    expect(line.status).toBe('approved');
    expect(line.actedByUserId).toBe(bob.id);
    expect(line.approverId).toBe(alice.id); // 원래 결재자는 그대로
    expect(line.comment).toContain('[대결]');
  });

  it('위임 없으면 carol(타인) 처리 시 403 NOT_YOUR_TURN', async () => {
    const doc = await makeDoc(alice.id);
    const svc = new ApprovalService();
    await expect(svc.approve(doc.id, carol.id, '시도')).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('비활성 위임은 권한 X', async () => {
    await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 86400_000),
        isActive: false, // ← 비활성
      },
    });
    const doc = await makeDoc(alice.id);
    const svc = new ApprovalService();
    await expect(svc.approve(doc.id, bob.id, '시도')).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('만료된 위임은 권한 X', async () => {
    await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(Date.now() - 86400_000 * 10),
        endDate: new Date(Date.now() - 86400_000), // ← 어제 만료
        isActive: true,
      },
    });
    const doc = await makeDoc(alice.id);
    const svc = new ApprovalService();
    await expect(svc.approve(doc.id, bob.id, '시도')).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('위임 처리한 반려도 [대결] 코멘트 + actedByUserId 기록', async () => {
    await prisma.approvalDelegation.create({
      data: {
        fromUserId: alice.id,
        toUserId: bob.id,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 86400_000),
        isActive: true,
      },
    });
    const doc = await makeDoc(alice.id);
    const svc = new ApprovalService();
    await svc.reject(doc.id, bob.id, '반려 사유');

    const reloaded = await prisma.approvalDocument.findUnique({
      where: { id: doc.id },
      include: { lines: true },
    });
    expect(reloaded?.status).toBe('rejected');
    const line = reloaded!.lines[0];
    expect(line.status).toBe('rejected');
    expect(line.actedByUserId).toBe(bob.id);
    expect(line.comment).toContain('[대결]');
    expect(line.comment).toContain('반려 사유');
  });
});
