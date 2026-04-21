import { describe, it, expect } from 'vitest';
import { advisoryLockKey } from './attendance.service';

describe('advisoryLockKey', () => {
  it('동일 입력 → 동일 키 (deterministic)', () => {
    const k1 = advisoryLockKey('u1', 'check_in', '2026-04-21');
    const k2 = advisoryLockKey('u1', 'check_in', '2026-04-21');
    expect(k1).toBe(k2);
  });

  it('다른 userId → 다른 키', () => {
    const k1 = advisoryLockKey('u1', 'check_in', '2026-04-21');
    const k2 = advisoryLockKey('u2', 'check_in', '2026-04-21');
    expect(k1).not.toBe(k2);
  });

  it('다른 type → 다른 키', () => {
    const k1 = advisoryLockKey('u1', 'check_in', '2026-04-21');
    const k2 = advisoryLockKey('u1', 'check_out', '2026-04-21');
    expect(k1).not.toBe(k2);
  });

  it('다른 날짜 → 다른 키', () => {
    const k1 = advisoryLockKey('u1', 'check_in', '2026-04-21');
    const k2 = advisoryLockKey('u1', 'check_in', '2026-04-22');
    expect(k1).not.toBe(k2);
  });

  it('PostgreSQL bigint 범위 내 (0 ~ 2^63-1)', () => {
    const key = advisoryLockKey('random-user-id', 'check_in', '2026-04-21');
    expect(key).toBeLessThanOrEqual(0x7fffffffffffffffn);
    expect(key).toBeGreaterThanOrEqual(0n);
  });

  it('긴 UUID도 안전하게 해시', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const key = advisoryLockKey(uuid, 'check_in', '2026-04-21');
    expect(typeof key).toBe('bigint');
    expect(key).toBeLessThanOrEqual(0x7fffffffffffffffn);
  });
});
