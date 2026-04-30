/**
 * GET /api/inventory/lookup?code=... 테스트
 *
 * 모바일 바코드/QR 스캐너로 읽은 코드 → 자재 조회.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import inventoryRoutes from '../src/routes/inventory.routes';
import { config } from '../src/config';
import { createTestUser, uniqueId } from './fixtures';

const app = express();
app.use(express.json());
app.use('/inventory', inventoryRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let user: Awaited<ReturnType<typeof createTestUser>>;
let activeItemId: string;
let inactiveItemId: string;
let inventoryModuleInitial: boolean | null = null;
const activeCode = uniqueId('CODE').toUpperCase();
const inactiveCode = uniqueId('OLD').toUpperCase();

beforeAll(async () => {
  user = await createTestUser({ role: 'user' as any });
  // inventory 모듈이 비활성이면 checkModule 미들웨어가 403 반환 — 테스트 동안 활성화
  const mod = await prisma.featureModule.findUnique({ where: { name: 'inventory' } });
  if (mod) {
    inventoryModuleInitial = mod.isEnabled;
    if (!mod.isEnabled) {
      await prisma.featureModule.update({ where: { id: mod.id }, data: { isEnabled: true } });
    }
  }
  const a = await prisma.inventoryItem.create({
    data: { code: activeCode, name: 'Active 자재', unit: 'EA', currentStock: 5 },
  });
  activeItemId = a.id;
  const b = await prisma.inventoryItem.create({
    data: { code: inactiveCode, name: 'Inactive 자재', unit: 'EA', isActive: false },
  });
  inactiveItemId = b.id;
});

afterAll(async () => {
  await prisma.inventoryItem.deleteMany({ where: { id: { in: [activeItemId, inactiveItemId] } } });
  if (inventoryModuleInitial !== null) {
    await prisma.featureModule
      .update({ where: { name: 'inventory' }, data: { isEnabled: inventoryModuleInitial } })
      .catch(() => {});
  }
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

describe('GET /inventory/lookup', () => {
  it('인증 없이 호출 → 401', async () => {
    const res = await request(app).get(`/inventory/lookup?code=${activeCode}`);
    expect(res.status).toBe(401);
  });

  it('code 파라미터 없음 → 400 CODE_REQUIRED', async () => {
    const res = await request(app)
      .get('/inventory/lookup')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_REQUIRED');
  });

  it('정확한 코드 → 200 + item', async () => {
    const res = await request(app)
      .get(`/inventory/lookup?code=${activeCode}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(activeItemId);
    expect(res.body.data.code).toBe(activeCode);
  });

  it('존재하지 않는 코드 → 404', async () => {
    const res = await request(app)
      .get(`/inventory/lookup?code=NONEXISTENT-9999`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('비활성 자재는 404 (스캐너에서 안 보여야)', async () => {
    const res = await request(app)
      .get(`/inventory/lookup?code=${inactiveCode}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });

  it('공백 trim 처리 (스캐너 출력에 trailing space 있을 수 있음)', async () => {
    const res = await request(app)
      .get(`/inventory/lookup?code=${encodeURIComponent('  ' + activeCode + '  ')}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe(activeCode);
  });
});
