/**
 * 근로기준법 기반 연차 자동 부여 서비스
 *
 * 근거: 근로기준법 제60조
 *
 *  근속기간            | 부여일수
 *  --------------------|----------
 *  1년 미만 (월차)     | 월 1일 (최대 11일) — 매월 만근 시
 *  1년 이상 ~ 3년 미만 | 15일
 *  3년 이상 ~ 5년 미만 | 16일
 *  5년 이상 ~ 7년 미만 | 17일
 *  ...                 | 2년마다 +1일
 *  21년 이상           | 25일 (상한)
 *
 * 실행 주체:
 *   - cron 스케줄러가 매년 1월 1일 새벽에 전 직원 대상 실행 (연간 부여)
 *   - 월차는 매월 1일 실행 (입사 1년 미만 직원만)
 *   - 수동 실행: 관리자 콘솔에서 특정 사용자/연도 재계산
 *
 * 멱등성:
 *   - 이미 해당 연도 VacationBalance가 존재하고 `grantedAt != null`이면 skip
 *   - `usedDays`는 보존 (연도 중간에 재실행해도 실제 사용분은 유지)
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { logger } from '../config/logger';

/**
 * 근속년수(정수 기준)에 따른 연차 일수
 * @param tenureYears 완료된 근속년수 (소수 불가, Math.floor)
 * @returns 부여일수
 */
export function calculateAnnualDays(tenureYears: number): number {
  if (tenureYears < 1) return 0; // 월차 별도 처리
  if (tenureYears < 3) return 15;
  // 3년 이상: 3년차 16일, 이후 2년마다 +1일, 상한 25일
  const extra = Math.floor((tenureYears - 1) / 2); // 3년차: (3-1)/2=1, 5년차=2, ...
  return Math.min(15 + extra, 25);
}

/**
 * 근속년수 계산 — 입사일 기준, 특정 기준일까지 완료된 연수
 * 월/일 단위 정확 계산: 입사 기념일이 지나야 +1년
 * 예) 2025-01-01 입사, 2026-01-01 기준 → 1년
 *     2025-01-01 입사, 2025-12-31 기준 → 0년
 */
export function calculateTenureYears(hireDate: Date, asOf: Date): number {
  if (asOf.getTime() < hireDate.getTime()) return 0;
  let years = asOf.getUTCFullYear() - hireDate.getUTCFullYear();
  const mdAsOf = asOf.getUTCMonth() * 100 + asOf.getUTCDate();
  const mdHire = hireDate.getUTCMonth() * 100 + hireDate.getUTCDate();
  if (mdAsOf < mdHire) years -= 1;
  return Math.max(0, years);
}

/**
 * 특정 사용자의 특정 연도 VacationBalance 부여 (멱등)
 *
 * @returns 부여/업데이트된 balance, 또는 skip 사유
 */
export async function grantAnnualLeaveForUser(
  userId: string,
  year: number,
  opts: { force?: boolean } = {},
): Promise<
  | { ok: true; totalDays: number; tenureYears: number; created: boolean }
  | { ok: false; reason: string }
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, hireDate: true },
  });
  if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };
  if (user.status !== 'active') return { ok: false, reason: 'USER_INACTIVE' };

  const hireDate = user.hireDate;
  if (!hireDate) return { ok: false, reason: 'NO_HIRE_DATE' };

  // 해당 연도 1월 1일 기준 근속년수
  const asOf = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const tenureYears = calculateTenureYears(hireDate, asOf);
  const totalDays = calculateAnnualDays(tenureYears);

  if (totalDays === 0 && tenureYears < 1) {
    // 1년 미만 — 연간 부여가 아니라 월차 방식
    return { ok: false, reason: 'TENURE_LESS_THAN_ONE_YEAR_USE_MONTHLY' };
  }

  const existing = await prisma.vacationBalance.findUnique({
    where: { userId_year: { userId, year } },
  });

  if (existing && existing.grantedAt && !opts.force) {
    return { ok: false, reason: 'ALREADY_GRANTED' };
  }

  // upsert — 기존 usedDays 보존
  const result = await prisma.vacationBalance.upsert({
    where: { userId_year: { userId, year } },
    update: {
      totalDays,
      remainDays: totalDays - (existing?.usedDays ?? 0),
      tenureYears,
      grantedAt: new Date(),
    },
    create: {
      userId,
      year,
      totalDays,
      usedDays: 0,
      remainDays: totalDays,
      tenureYears,
      grantedAt: new Date(),
    },
  });

  return {
    ok: true,
    totalDays: result.totalDays,
    tenureYears,
    created: !existing,
  };
}

/**
 * 월차 부여 — 입사 1년 미만 직원에게 매월 +1일 (최대 11일)
 * - 특정 월의 "출근 요건"은 검증 안함 (단순 누적, 관리자가 필요 시 조정)
 * - 매달 실행 시 해당 사용자의 tenureMonths가 11 이하인 경우에만 +1
 */
export async function grantMonthlyLeaveForUser(
  userId: string,
  asOf: Date = new Date(),
): Promise<
  | { ok: true; grantedThisMonth: boolean; newTotal: number }
  | { ok: false; reason: string }
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, hireDate: true },
  });
  if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };
  if (user.status !== 'active') return { ok: false, reason: 'USER_INACTIVE' };
  if (!user.hireDate) return { ok: false, reason: 'NO_HIRE_DATE' };

  // 근속 개월수 (1년 미만만 월차 대상)
  const msPerMonth = 30.4375 * 24 * 60 * 60 * 1000;
  const months = Math.floor((asOf.getTime() - user.hireDate.getTime()) / msPerMonth);
  if (months < 1 || months >= 12) {
    return { ok: false, reason: 'NOT_IN_MONTHLY_WINDOW' };
  }

  const year = asOf.getFullYear();
  const existing = await prisma.vacationBalance.findUnique({
    where: { userId_year: { userId, year } },
  });

  // 월차는 최대 11일까지만 누적
  const currentMonthly = existing?.totalDays ?? 0;
  if (currentMonthly >= 11) {
    return { ok: false, reason: 'MAX_MONTHLY_REACHED' };
  }

  const newTotal = currentMonthly + 1;

  if (existing) {
    await prisma.vacationBalance.update({
      where: { id: existing.id },
      data: {
        totalDays: newTotal,
        remainDays: newTotal - existing.usedDays,
        tenureYears: 0,
      },
    });
  } else {
    await prisma.vacationBalance.create({
      data: {
        userId,
        year,
        totalDays: newTotal,
        usedDays: 0,
        remainDays: newTotal,
        tenureYears: 0,
        grantedAt: new Date(),
      },
    });
  }

  return { ok: true, grantedThisMonth: true, newTotal };
}

// ── 배치 실행 ──

export interface AccrualBatchResult {
  year: number;
  succeeded: number;
  skipped: number;
  failed: number;
  details: Array<{ userId: string; result: string }>;
}

/** 매년 1월 1일 실행 — 모든 active 사용자 대상 */
export async function runAnnualAccrualBatch(
  year: number,
  opts: { force?: boolean } = {},
): Promise<AccrualBatchResult> {
  const users = await prisma.user.findMany({
    where: { status: 'active', hireDate: { not: null } },
    select: { id: true },
  });

  const result: AccrualBatchResult = { year, succeeded: 0, skipped: 0, failed: 0, details: [] };

  for (const u of users) {
    const r = await grantAnnualLeaveForUser(u.id, year, opts).catch((e: Error) => ({
      ok: false as const,
      reason: `ERROR:${e.message}`,
    }));

    if (r.ok) {
      result.succeeded += 1;
      result.details.push({ userId: u.id, result: `granted ${r.totalDays}d (${r.tenureYears}y)` });
    } else {
      if (r.reason === 'ALREADY_GRANTED' || r.reason === 'TENURE_LESS_THAN_ONE_YEAR_USE_MONTHLY') {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
      result.details.push({ userId: u.id, result: r.reason });
    }
  }

  logger.info(
    { year, succeeded: result.succeeded, skipped: result.skipped, failed: result.failed },
    '[vacation-accrual] annual batch completed',
  );
  return result;
}

/** 매월 1일 실행 — 근속 1년 미만 active 사용자 대상 */
export async function runMonthlyAccrualBatch(
  asOf: Date = new Date(),
): Promise<AccrualBatchResult> {
  const oneYearAgo = new Date(asOf);
  oneYearAgo.setFullYear(asOf.getFullYear() - 1);

  const users = await prisma.user.findMany({
    where: {
      status: 'active',
      hireDate: { not: null, gt: oneYearAgo },
    },
    select: { id: true },
  });

  const result: AccrualBatchResult = {
    year: asOf.getFullYear(),
    succeeded: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const u of users) {
    const r = await grantMonthlyLeaveForUser(u.id, asOf).catch((e: Error) => ({
      ok: false as const,
      reason: `ERROR:${e.message}`,
    }));
    if (r.ok) {
      result.succeeded += 1;
      result.details.push({ userId: u.id, result: `+1d → ${r.newTotal}d` });
    } else {
      if (r.reason === 'NOT_IN_MONTHLY_WINDOW' || r.reason === 'MAX_MONTHLY_REACHED') {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
      result.details.push({ userId: u.id, result: r.reason });
    }
  }

  logger.info(
    { asOf: asOf.toISOString(), succeeded: result.succeeded, skipped: result.skipped },
    '[vacation-accrual] monthly batch completed',
  );
  return result;
}

// ── 공휴일 서비스 ──

/** 특정 기간의 공휴일 조회 */
export async function getHolidaysInRange(
  startDate: Date,
  endDate: Date,
): Promise<Array<{ date: Date; name: string; type: string }>> {
  return prisma.holiday.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { date: true, name: true, type: true },
    orderBy: { date: 'asc' },
  });
}

/** 두 날짜 사이의 "근무일수" 계산 — 주말 + 공휴일 제외 */
export async function countWorkdays(
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const holidays = await getHolidaysInRange(startDate, endDate);
  const holidayTimestamps = new Set(
    holidays
      .filter((h) => h.type !== 'event') // event는 정상 근무
      .map((h) => new Date(h.date).toISOString().slice(0, 10)),
  );

  let count = 0;
  const cursor = new Date(startDate);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor <= end) {
    const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat
    const key = cursor.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidayTimestamps.has(key)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
