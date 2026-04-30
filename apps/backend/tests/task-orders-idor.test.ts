/**
 * 작업지시서 IDOR (Insecure Direct Object Reference) 회귀 테스트.
 *
 * 7차 감사 발견:
 * - GET /task-orders/:id 가 권한 체크 없이 임의 사용자에게 task 상세(영업/단가/거래처/billing) 노출
 * - POST /task-orders/:id/comments 가 외부 사용자에게도 댓글 spam 허용
 * - PATCH /task-orders/:id/checklist/:checkId 가 외부 사용자에게도 토글 허용
 *
 * 모두 작성자/배정자/관리자만 가능하도록 canAccessTask 적용 확인.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import taskOrderRoutes from '../src/routes/task-orders.routes';
import { config } from '../src/config';
import { createTestUser, uniqueId } from './fixtures';

const app = express();
app.use(express.json());
app.use('/task-orders', taskOrderRoutes);

function tokenFor(u: { id: string; role: string }) {
  return jwt.sign({ sub: u.id, role: u.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let creator: Awaited<ReturnType<typeof createTestUser>>;
let assignee: Awaited<ReturnType<typeof createTestUser>>;
let outsider: Awaited<ReturnType<typeof createTestUser>>;
let admin: Awaited<ReturnType<typeof createTestUser>>;
let taskId: string;
let checklistId: string;
let moduleInitial: boolean | null = null;

beforeAll(async () => {
  // 모듈 활성화
  const mod = await prisma.featureModule.findUnique({ where: { name: 'task_orders' } });
  if (mod) {
    moduleInitial = mod.isEnabled;
    if (!mod.isEnabled) await prisma.featureModule.update({ where: { id: mod.id }, data: { isEnabled: true } });
  }

  creator = await createTestUser({ role: 'user' as any });
  assignee = await createTestUser({ role: 'user' as any });
  outsider = await createTestUser({ role: 'user' as any });
  admin = await createTestUser({ role: 'admin' as any });

  const t = await prisma.taskOrder.create({
    data: {
      taskNumber: uniqueId('IDOR'),
      title: 'IDOR 테스트',
      creatorId: creator.id,
      status: 'draft',
      // sensitive 필드 — outsider 가 봐서는 안 됨
      description: '거래처 단가 정보 포함',
      assignees: { create: [{ userId: assignee.id, role: 'main' }] },
    },
  });
  taskId = t.id;

  const cl = await prisma.taskChecklist.create({
    data: { taskId, content: '체크 항목', sortOrder: 1 },
  });
  checklistId = cl.id;
});

afterAll(async () => {
  await prisma.taskComment.deleteMany({ where: { taskId } }).catch(() => {});
  await prisma.taskChecklist.deleteMany({ where: { taskId } }).catch(() => {});
  await prisma.taskAssignee.deleteMany({ where: { taskId } }).catch(() => {});
  await prisma.taskOrder.delete({ where: { id: taskId } }).catch(() => {});
  if (moduleInitial !== null) {
    await prisma.featureModule.update({
      where: { name: 'task_orders' },
      data: { isEnabled: moduleInitial },
    }).catch(() => {});
  }
  await prisma.user.deleteMany({
    where: { id: { in: [creator.id, assignee.id, outsider.id, admin.id] } },
  });
  await prisma.$disconnect();
});

describe('GET /task-orders/:id IDOR (7차 감사 C1)', () => {
  it('작성자는 200 + 정상 데이터', async () => {
    const res = await request(app)
      .get(`/task-orders/${taskId}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(taskId);
  });

  it('배정자는 200', async () => {
    const res = await request(app)
      .get(`/task-orders/${taskId}`)
      .set('Authorization', `Bearer ${tokenFor(assignee)}`);
    expect(res.status).toBe(200);
  });

  it('관리자는 200', async () => {
    const res = await request(app)
      .get(`/task-orders/${taskId}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });

  it('외부인은 403 + 영업 정보 미노출', async () => {
    const res = await request(app)
      .get(`/task-orders/${taskId}`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined(); // task 데이터 자체가 응답에 없어야 함
  });

  it('미인증 → 401', async () => {
    const res = await request(app).get(`/task-orders/${taskId}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /task-orders/:id/comments IDOR (7차 감사 C2)', () => {
  it('작성자는 댓글 작성 가능 200', async () => {
    const res = await request(app)
      .post(`/task-orders/${taskId}/comments`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ content: 'creator 댓글' });
    expect(res.status).toBe(201);
  });

  it('외부인이 댓글 spam 시도 → 403', async () => {
    const res = await request(app)
      .post(`/task-orders/${taskId}/comments`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ content: '스팸 댓글' });
    expect(res.status).toBe(403);

    // DB 에 외부인 댓글이 들어가지 않았는지 확인
    const count = await prisma.taskComment.count({
      where: { taskId, userId: outsider.id },
    });
    expect(count).toBe(0);
  });

  it('빈 content → 400', async () => {
    const res = await request(app)
      .post(`/task-orders/${taskId}/comments`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /task-orders/:id/checklist/:checkId IDOR (7차 감사 C3)', () => {
  it('작성자가 토글 → 200', async () => {
    const res = await request(app)
      .patch(`/task-orders/${taskId}/checklist/${checklistId}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(200);
  });

  it('외부인이 토글 시도 → 403', async () => {
    const res = await request(app)
      .patch(`/task-orders/${taskId}/checklist/${checklistId}`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
  });

  it('다른 task 의 checklist ID 로 cross-task 변조 시도 → 404', async () => {
    // 다른 task 만들고 그쪽 checkId 를 alice 토큰으로 우리 task 에 시도
    const otherTask = await prisma.taskOrder.create({
      data: {
        taskNumber: uniqueId('OTHER'),
        title: 'other',
        creatorId: outsider.id,
        status: 'draft',
      },
    });
    const otherCheck = await prisma.taskChecklist.create({
      data: { taskId: otherTask.id, content: 'other check', sortOrder: 1 },
    });

    // creator 가 본인 task ID + 다른 task 의 checkId 로 호출
    const res = await request(app)
      .patch(`/task-orders/${taskId}/checklist/${otherCheck.id}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(404); // taskId !== item.taskId 검증

    await prisma.taskChecklist.delete({ where: { id: otherCheck.id } });
    await prisma.taskOrder.delete({ where: { id: otherTask.id } });
  });
});
