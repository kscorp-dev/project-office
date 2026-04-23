/**
 * 관리자 콘솔 모듈 토글 — critical 모듈 권한 강화 테스트
 *
 * - 일반 admin은 critical 모듈을 토글할 수 없다 (403 CRITICAL_MODULE_SUPER_ADMIN_ONLY)
 * - super_admin은 critical 모듈을 토글할 수 있다
 * - 일반 모듈은 admin도 토글 가능
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import prisma from '../src/config/prisma';
import adminRoutes from '../src/routes/admin.routes';
import { createTestUser } from './fixtures';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.jwt.accessSecret,
    { expiresIn: '1h' },
  );
}

let superAdmin: Awaited<ReturnType<typeof createTestUser>>;
let admin: Awaited<ReturnType<typeof createTestUser>>;
let criticalModuleId: string;
let normalModuleId: string;
let criticalInitial = true;
let normalInitial = true;

beforeAll(async () => {
  superAdmin = await createTestUser({ role: 'super_admin' as any });
  admin = await createTestUser({ role: 'admin' as any });

  // 기존 cctv (critical) 와 calendar (non-critical) 사용
  const cctv = await prisma.featureModule.findUnique({ where: { name: 'cctv' } });
  const cal = await prisma.featureModule.findUnique({ where: { name: 'calendar' } });
  if (!cctv || !cal) throw new Error('seed에 cctv/calendar 모듈이 있어야 합니다');
  criticalModuleId = cctv.id;
  normalModuleId = cal.id;
  criticalInitial = cctv.isEnabled;
  normalInitial = cal.isEnabled;
});

afterAll(async () => {
  // 초기값 복원
  await prisma.featureModule.update({ where: { id: criticalModuleId }, data: { isEnabled: criticalInitial } });
  await prisma.featureModule.update({ where: { id: normalModuleId }, data: { isEnabled: normalInitial } });
  await prisma.user.deleteMany({ where: { id: { in: [superAdmin.id, admin.id] } } });
  await prisma.$disconnect();
});

describe('PATCH /api/admin/modules/:id — critical gate', () => {
  it('일반 admin이 critical(cctv) 모듈 토글 시도 → 403', async () => {
    const res = await request(app)
      .patch(`/api/admin/modules/${criticalModuleId}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isEnabled: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CRITICAL_MODULE_SUPER_ADMIN_ONLY');
  });

  it('super_admin은 critical(cctv) 모듈을 비활성화 가능', async () => {
    const res = await request(app)
      .patch(`/api/admin/modules/${criticalModuleId}`)
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ isEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isEnabled).toBe(false);

    const reloaded = await prisma.featureModule.findUnique({ where: { id: criticalModuleId } });
    expect(reloaded?.isEnabled).toBe(false);
  });

  it('super_admin이 다시 활성화', async () => {
    const res = await request(app)
      .patch(`/api/admin/modules/${criticalModuleId}`)
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ isEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isEnabled).toBe(true);
  });

  it('일반 admin은 non-critical(calendar) 토글 가능', async () => {
    const res = await request(app)
      .patch(`/api/admin/modules/${normalModuleId}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isEnabled).toBe(false);

    // 복원
    await request(app)
      .patch(`/api/admin/modules/${normalModuleId}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ isEnabled: true });
  });
});
