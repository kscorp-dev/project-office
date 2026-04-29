/**
 * 지오펜스 서비스 + 출퇴근 통합 테스트
 *
 * 커버:
 *   1. haversineMeters — 알려진 두 점 거리 검증
 *   2. checkGeofence — 정책 enabled / 좌표 미등록 / 반경 안/밖 케이스
 *   3. POST /attendance/check — 반경 밖 + 사유 없음 → 400 OUT_OF_GEOFENCE
 *      반경 밖 + 사유 있음 → 201 + offsite=true + note 에 [원격] prefix
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import attendanceRoutes from '../src/routes/attendance.routes';
import { config } from '../src/config';
import { createTestUser } from './fixtures';
import { haversineMeters, loadGeofenceConfig, checkGeofence } from '../src/services/geofence';

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let user: Awaited<ReturnType<typeof createTestUser>>;
const SEOUL = { lat: 37.5665, lng: 126.9780 };
const BUSAN = { lat: 35.1796, lng: 129.0756 };

beforeAll(async () => {
  user = await createTestUser({ role: 'user' as any });
  // attendance 모듈 활성화 보장
  await prisma.featureModule.upsert({
    where: { name: 'attendance' },
    update: { isEnabled: true },
    create: { name: 'attendance', displayName: '근무관리', isEnabled: true, sortOrder: 5, isCritical: true },
  });
});

afterAll(async () => {
  await prisma.attendance.deleteMany({ where: { userId: user.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // 매 테스트마다 attendance 기록 초기화 + 지오펜스 설정 초기화
  await prisma.attendance.deleteMany({ where: { userId: user.id } });
  await prisma.systemSetting.deleteMany({
    where: { key: { in: ['geofence_enabled', 'office_lat', 'office_lng', 'office_radius_m'] } },
  });
});

describe('haversineMeters', () => {
  it('서울 ↔ 부산 거리 약 325 km (오차 1%)', () => {
    const d = haversineMeters(SEOUL.lat, SEOUL.lng, BUSAN.lat, BUSAN.lng);
    // 실제 약 325,000m. ±1% 허용
    expect(d).toBeGreaterThan(320_000);
    expect(d).toBeLessThan(330_000);
  });

  it('동일 좌표 → 0', () => {
    expect(haversineMeters(SEOUL.lat, SEOUL.lng, SEOUL.lat, SEOUL.lng)).toBeCloseTo(0, 1);
  });

  it('약 100m 떨어진 점 (위도 0.0009도)', () => {
    const d = haversineMeters(SEOUL.lat, SEOUL.lng, SEOUL.lat + 0.0009, SEOUL.lng);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(110);
  });
});

describe('loadGeofenceConfig', () => {
  it('설정 미등록 → enabled=false, 좌표 null', async () => {
    const cfg = await loadGeofenceConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.officeLat).toBeNull();
    expect(cfg.officeLng).toBeNull();
    expect(cfg.radiusM).toBe(200); // 기본값
  });

  it('설정 등록 시 그대로 반영', async () => {
    await prisma.systemSetting.createMany({
      data: [
        { key: 'geofence_enabled', value: 'true', category: 'attendance' },
        { key: 'office_lat', value: '37.5665', category: 'attendance' },
        { key: 'office_lng', value: '126.978', category: 'attendance' },
        { key: 'office_radius_m', value: '300', category: 'attendance' },
      ],
    });
    const cfg = await loadGeofenceConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.officeLat).toBeCloseTo(37.5665);
    expect(cfg.officeLng).toBeCloseTo(126.978);
    expect(cfg.radiusM).toBe(300);
  });
});

describe('checkGeofence', () => {
  beforeEach(async () => {
    await prisma.systemSetting.createMany({
      data: [
        { key: 'geofence_enabled', value: 'true', category: 'attendance' },
        { key: 'office_lat', value: String(SEOUL.lat), category: 'attendance' },
        { key: 'office_lng', value: String(SEOUL.lng), category: 'attendance' },
        { key: 'office_radius_m', value: '200', category: 'attendance' },
      ],
    });
  });

  it('사무실 좌표와 거의 동일 → inside=true', async () => {
    const r = await checkGeofence(SEOUL.lat, SEOUL.lng);
    expect(r.enabled).toBe(true);
    expect(r.configured).toBe(true);
    expect(r.distanceM!).toBeLessThan(1);
    expect(r.inside).toBe(true);
  });

  it('서울에서 부산 → inside=false', async () => {
    const r = await checkGeofence(BUSAN.lat, BUSAN.lng);
    expect(r.inside).toBe(false);
    expect(r.distanceM!).toBeGreaterThan(200_000);
  });

  it('클라이언트 좌표 미전송 → inside=undefined', async () => {
    const r = await checkGeofence(null, null);
    expect(r.inside).toBeUndefined();
    expect(r.distanceM).toBeNull();
  });
});

describe('POST /attendance/check 지오펜스 통합', () => {
  beforeEach(async () => {
    await prisma.systemSetting.createMany({
      data: [
        { key: 'geofence_enabled', value: 'true', category: 'attendance' },
        { key: 'office_lat', value: String(SEOUL.lat), category: 'attendance' },
        { key: 'office_lng', value: String(SEOUL.lng), category: 'attendance' },
        { key: 'office_radius_m', value: '200', category: 'attendance' },
      ],
    });
  });

  it('반경 밖 + 사유 없음 → 400 OUT_OF_GEOFENCE', async () => {
    const res = await request(app)
      .post('/api/attendance/check')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ type: 'check_in', latitude: BUSAN.lat, longitude: BUSAN.lng });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OUT_OF_GEOFENCE');
    expect(res.body.error.details.distanceM).toBeGreaterThan(200_000);
    expect(res.body.error.details.inside).toBe(false);
  });

  it('반경 밖 + 사유 있음 → 201 + offsite=true + [원격] prefix', async () => {
    const res = await request(app)
      .post('/api/attendance/check')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({
        type: 'check_in',
        latitude: BUSAN.lat,
        longitude: BUSAN.lng,
        note: '출장 중 부산 사무소',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.geofence.offsite).toBe(true);
    expect(res.body.data.note).toContain('[원격]');
    expect(res.body.data.note).toContain('출장 중 부산');
  });

  it('반경 안 → 201 + offsite=false', async () => {
    const res = await request(app)
      .post('/api/attendance/check')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ type: 'check_in', latitude: SEOUL.lat, longitude: SEOUL.lng });
    expect(res.status).toBe(201);
    expect(res.body.data.geofence.inside).toBe(true);
    expect(res.body.data.geofence.offsite).toBe(false);
  });

  it('정책 비활성 → 좌표 무관하게 모두 통과', async () => {
    await prisma.systemSetting.update({
      where: { key: 'geofence_enabled' },
      data: { value: 'false' },
    });
    const res = await request(app)
      .post('/api/attendance/check')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ type: 'check_in', latitude: BUSAN.lat, longitude: BUSAN.lng });
    expect(res.status).toBe(201);
    expect(res.body.data.geofence.enabled).toBe(false);
  });
});

describe('GET /attendance/geofence', () => {
  it('미등록 → configured=false, officeLat/Lng null', async () => {
    const res = await request(app)
      .get('/api/attendance/geofence')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.officeLat).toBeNull();
    expect(res.body.data.radiusM).toBe(200);
  });

  it('등록 후 → configured=true + 좌표 반환', async () => {
    await prisma.systemSetting.createMany({
      data: [
        { key: 'geofence_enabled', value: 'true', category: 'attendance' },
        { key: 'office_lat', value: String(SEOUL.lat), category: 'attendance' },
        { key: 'office_lng', value: String(SEOUL.lng), category: 'attendance' },
        { key: 'office_radius_m', value: '300', category: 'attendance' },
      ],
    });
    const res = await request(app)
      .get('/api/attendance/geofence')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.officeLat).toBeCloseTo(SEOUL.lat);
    expect(res.body.data.officeLng).toBeCloseTo(SEOUL.lng);
    expect(res.body.data.radiusM).toBe(300);
    expect(res.body.data.enabled).toBe(true);
  });
});
