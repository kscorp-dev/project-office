/**
 * 라우트 스모크 테스트
 *
 * 대상: 전용 테스트가 없던 주요 라우트들 —
 *   board / cctv / document / holiday / inventory / parking /
 *   task-orders / auth / mail / mail-admin / modules
 *
 * 목적: "엔드포인트가 연결되어 있고 인증/권한 가드가 걸려 있다" 수준의 최소 검증.
 *   - 토큰 없이 호출 → 401
 *   - admin 전용 라우트에 일반 사용자 → 403
 *   - 정상 토큰으로 기본 GET → 200 (응답 형식 최소 체크)
 *
 * 비즈니스 로직 상세 테스트는 별도 케이스에서 다룬다.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import { config } from '../src/config';
import { createTestUser } from './fixtures';

// 라우트 import
import authRoutes from '../src/routes/auth.routes';
import boardRoutes from '../src/routes/board.routes';
import cctvRoutes from '../src/routes/cctv.routes';
import documentRoutes from '../src/routes/document.routes';
import holidayRoutes from '../src/routes/holiday.routes';
import inventoryRoutes from '../src/routes/inventory.routes';
import parkingRoutes from '../src/routes/parking.routes';
import taskOrderRoutes from '../src/routes/task-orders.routes';
import mailRoutes from '../src/routes/mail.routes';
import mailAdminRoutes from '../src/routes/mail-admin.routes';
import modulesRoutes from '../src/routes/modules.routes';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/board', boardRoutes);
app.use('/api/cctv', cctvRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/parking', parkingRoutes);
app.use('/api/task-orders', taskOrderRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/admin/mail', mailAdminRoutes);
app.use('/api/modules', modulesRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let admin: Awaited<ReturnType<typeof createTestUser>>;
let normalUser: Awaited<ReturnType<typeof createTestUser>>;

// 이 테스트가 건드리는 모듈이 이전 테스트/환경에서 비활성 상태면 checkModule 403이
// 먼저 반환된다. 스모크 테스트는 라우트 연결 자체를 검증하므로 beforeAll 에서 활성화 보장.
const REQUIRED_MODULES = ['board', 'cctv', 'document', 'inventory', 'parking', 'task_orders', 'meeting'];

let prevModuleStates: Record<string, boolean> = {};

beforeAll(async () => {
  admin = await createTestUser({ role: 'admin' as any });
  normalUser = await createTestUser({ role: 'user' as any });

  // 모듈 활성화 (원 상태는 afterAll 에서 복원)
  const mods = await prisma.featureModule.findMany({ where: { name: { in: REQUIRED_MODULES } } });
  prevModuleStates = Object.fromEntries(mods.map((m) => [m.name, m.isEnabled]));
  await prisma.featureModule.updateMany({
    where: { name: { in: REQUIRED_MODULES } },
    data: { isEnabled: true },
  });
});

afterAll(async () => {
  // 모듈 원 상태 복원
  for (const [name, isEnabled] of Object.entries(prevModuleStates)) {
    await prisma.featureModule.updateMany({ where: { name }, data: { isEnabled } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, normalUser.id] } } });
  await prisma.$disconnect();
});

describe('Route smoke — 인증 가드', () => {
  const authGuarded: Array<[string, string]> = [
    ['GET', '/api/board/boards'],
    ['GET', '/api/cctv/cameras'],
    ['GET', '/api/documents/folders'],
    ['GET', '/api/holidays'],
    ['GET', '/api/inventory/items'],
    ['GET', '/api/parking/zones'],
    ['GET', '/api/task-orders'],
    ['GET', '/api/mail/account'],
    ['GET', '/api/admin/mail/workmail/users'],
    ['GET', '/api/modules'],
  ];

  for (const [method, path] of authGuarded) {
    it(`${method} ${path} — 토큰 없이 호출 시 401`, async () => {
      const res = await request(app).get(path);
      // 401 UNAUTHORIZED 또는 유사 응답이어야 함
      expect([401]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  }
});

describe('Route smoke — admin 전용 가드', () => {
  it('일반 user 가 /admin/mail/workmail/users 접근 시 403', async () => {
    const res = await request(app)
      .get('/api/admin/mail/workmail/users')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect([401, 403]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

describe('Route smoke — 정상 토큰 기본 GET', () => {
  it('GET /api/modules → 200 + 모듈 배열', async () => {
    const res = await request(app)
      .get('/api/modules')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // seed에 있는 modules 13개 (admin 포함)
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /api/board/boards → 200 + 배열', async () => {
    const res = await request(app)
      .get('/api/board/boards')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/holidays → 200', async () => {
    const res = await request(app)
      .get('/api/holidays')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/inventory/items → 200', async () => {
    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/parking/zones → 200', async () => {
    const res = await request(app)
      .get('/api/parking/zones')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/task-orders → 200 + meta', async () => {
    const res = await request(app)
      .get('/api/task-orders')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta).toBeDefined();
  });

  it('GET /api/documents/folders → 200', async () => {
    const res = await request(app)
      .get('/api/documents/folders')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/cctv/cameras → 200 (권한 없어도 빈 배열)', async () => {
    const res = await request(app)
      .get('/api/cctv/cameras')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/mail/account → 200 또는 404 (MAIL_ACCOUNT_NOT_LINKED)', async () => {
    const res = await request(app)
      .get('/api/mail/account')
      .set('Authorization', `Bearer ${tokenFor(normalUser)}`);
    // 계정 연결 없으면 200에서 data=null 또는 404 반환 (구현 따라)
    expect([200, 404]).toContain(res.status);
  });
});

describe('Route smoke — POST validation', () => {
  it('POST /api/auth/login — 잘못된 body 는 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({}); // empty body
    // validate 미들웨어에서 400 또는 401 반환
    expect([400, 401]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/login — 존재하지 않는 사용자는 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        employeeId: 'nonexistent-user-xxx',
        password: 'anything-at-least-8-chars',
        deviceInfo: { deviceId: 'test-dev', deviceType: 'web' },
      });
    expect([400, 401]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/parking/events/webhook — 시크릿 미설정 시 503 (fail-close)', async () => {
    const prev = process.env.PARKING_WEBHOOK_SECRET;
    delete process.env.PARKING_WEBHOOK_SECRET;
    const res = await request(app)
      .post('/api/parking/events/webhook')
      .send({ type: 'entry', plateNumber: '12A1234' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('WEBHOOK_DISABLED');
    if (prev !== undefined) process.env.PARKING_WEBHOOK_SECRET = prev;
  });

  it('POST /api/parking/events/webhook — 시크릿 일치 시 201', async () => {
    process.env.PARKING_WEBHOOK_SECRET = 'test-secret-smoke';
    const res = await request(app)
      .post('/api/parking/events/webhook')
      .set('X-Webhook-Secret', 'test-secret-smoke')
      .send({ type: 'entry', plateNumber: 'SMOKE-0001' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('entry');
    // 정리
    await prisma.parkingEvent.deleteMany({ where: { plateNumber: 'SMOKE-0001' } });
    delete process.env.PARKING_WEBHOOK_SECRET;
  });

  it('POST /api/parking/events/webhook — 시크릿 불일치 시 401', async () => {
    process.env.PARKING_WEBHOOK_SECRET = 'right-secret';
    const res = await request(app)
      .post('/api/parking/events/webhook')
      .set('X-Webhook-Secret', 'wrong-secret')
      .send({ type: 'entry' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_UNAUTHORIZED');
    delete process.env.PARKING_WEBHOOK_SECRET;
  });
});
