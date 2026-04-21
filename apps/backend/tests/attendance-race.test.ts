/**
 * Attendance advisory lock 동시성 통합 테스트
 *
 * Phase 4-3: pg_advisory_xact_lock으로 동일 (userId, type, date)에 대한
 * check-then-create race를 제거했는지 검증
 */
import { describe, it, expect, afterEach } from 'vitest';
import { prisma, createTestUser } from './fixtures';
import { recordAttendance } from '../src/services/attendance.service';
import { AppError } from '../src/services/auth.service';

describe('Attendance race condition (실제 DB)', () => {
  afterEach(async () => {
    // 각 테스트 후 오늘 생성된 attendance 정리는 개별 테스트가 담당
  });

  it('동일 사용자의 동시 check_in 2번 → 1번만 성공', async () => {
    const user = await createTestUser();

    const results = await Promise.allSettled([
      recordAttendance({ userId: user.id, type: 'check_in' }),
      recordAttendance({ userId: user.id, type: 'check_in' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(AppError);
    expect((reason as AppError).code).toBe('ALREADY_CHECKED');

    // DB에는 딱 1건만
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const count = await prisma.attendance.count({
      where: { userId: user.id, type: 'check_in', checkTime: { gte: today, lt: tomorrow } },
    });
    expect(count).toBe(1);

    // cleanup
    await prisma.attendance.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('check_in + check_out 동시 호출 → 둘 다 성공 (서로 다른 키)', async () => {
    const user = await createTestUser();

    const results = await Promise.allSettled([
      recordAttendance({ userId: user.id, type: 'check_in' }),
      recordAttendance({ userId: user.id, type: 'check_out' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(2);

    const count = await prisma.attendance.count({ where: { userId: user.id } });
    expect(count).toBe(2);

    await prisma.attendance.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('서로 다른 사용자의 동시 check_in → 모두 성공', async () => {
    const u1 = await createTestUser();
    const u2 = await createTestUser();

    const results = await Promise.allSettled([
      recordAttendance({ userId: u1.id, type: 'check_in' }),
      recordAttendance({ userId: u2.id, type: 'check_in' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);

    await prisma.attendance.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
  });

  it('한 사용자가 5번 동시 check_in → 1번만 성공 (stress)', async () => {
    const user = await createTestUser();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        recordAttendance({ userId: user.id, type: 'check_in' }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);
    // 모든 실패는 ALREADY_CHECKED
    for (const r of rejected) {
      const e = (r as PromiseRejectedResult).reason;
      expect((e as AppError).code).toBe('ALREADY_CHECKED');
    }

    await prisma.attendance.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
