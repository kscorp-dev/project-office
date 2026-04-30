/**
 * GET /admin/push/health + POST /admin/push/test 라우트 테스트
 *
 * 검증:
 *   - admin / super_admin 만 접근 가능
 *   - health: 현재 환경(DISABLE_PUSH / EXPO_ACCESS_TOKEN)을 정확히 반영
 *   - test: 본인 디바이스가 없으면 attempted=0, 있으면 1+ (DISABLE_PUSH=true 라
 *           실제 발송은 0 — payload 검증은 push-integration.test.ts 가 커버)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import adminRoutes from '../src/routes/admin.routes';
import { config } from '../src/config';
import { createTestUser } from './fixtures';

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let admin: Awaited<ReturnType<typeof createTestUser>>;
let normal: Awaited<ReturnType<typeof createTestUser>>;
const deviceIds: string[] = [];

beforeAll(async () => {
  admin = await createTestUser({ role: 'admin' as any });
  normal = await createTestUser({ role: 'user' as any });
});

afterAll(async () => {
  await prisma.userDevice.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, normal.id] } } });
  await prisma.$disconnect();
});

describe('GET /admin/push/health', () => {
  it('admin 권한 → 200 + health 페이로드', async () => {
    const res = await request(app)
      .get('/admin/push/health')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // setup.ts 가 DISABLE_PUSH=true 설정 → enabled=false 여야 함
    expect(res.body.data.enabled).toBe(false);
    expect(typeof res.body.data.totalActiveDevices).toBe('number');
    expect(Array.isArray(res.body.data.warnings)).toBe(true);
    // DISABLE_PUSH 경고가 포함되어야 함
    expect(res.body.data.warnings.some((w: string) => w.includes('DISABLE_PUSH'))).toBe(true);
  });

  it('일반 user → 403', async () => {
    const res = await request(app)
      .get('/admin/push/health')
      .set('Authorization', `Bearer ${tokenFor(normal)}`);
    expect(res.status).toBe(403);
  });

  it('미인증 → 401', async () => {
    const res = await request(app).get('/admin/push/health');
    expect(res.status).toBe(401);
  });
});

describe('POST /admin/push/test', () => {
  it('admin 권한 + 디바이스 없음 → 200, attempted=0', async () => {
    const res = await request(app)
      .post('/admin/push/test')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.attempted).toBe(0);
    // DISABLE_PUSH=true 라 sent 도 0
    expect(res.body.data.sent).toBe(0);
  });

  it('admin 디바이스 등록 후 테스트 푸시 → DISABLE_PUSH 이유 포함', async () => {
    // 가짜 디바이스 등록 (Expo 토큰 형식)
    const dev = await prisma.userDevice.create({
      data: {
        userId: admin.id,
        deviceId: 'test-device-1',
        deviceType: 'ios',
        deviceName: 'Test iPhone',
        pushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxx]',
        isActive: true,
      },
    });
    deviceIds.push(dev.id);

    const res = await request(app)
      .post('/admin/push/test')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('DISABLE_PUSH=true');
  });

  it('일반 user → 403', async () => {
    const res = await request(app)
      .post('/admin/push/test')
      .set('Authorization', `Bearer ${tokenFor(normal)}`);
    expect(res.status).toBe(403);
  });
});
