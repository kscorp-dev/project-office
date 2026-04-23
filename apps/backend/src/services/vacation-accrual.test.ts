/**
 * 연차 자동부여 단위 테스트 (DB 없이)
 * calculateAnnualDays / calculateTenureYears 순수 함수 검증
 */
import { describe, it, expect } from 'vitest';
import { calculateAnnualDays, calculateTenureYears } from './vacation-accrual.service';

describe('calculateAnnualDays (근로기준법 제60조)', () => {
  it('1년 미만 → 0 (월차 별도)', () => {
    expect(calculateAnnualDays(0)).toBe(0);
  });

  it('1~2년차 → 15일', () => {
    expect(calculateAnnualDays(1)).toBe(15);
    expect(calculateAnnualDays(2)).toBe(15);
  });

  it('3~4년차 → 16일', () => {
    expect(calculateAnnualDays(3)).toBe(16);
    expect(calculateAnnualDays(4)).toBe(16);
  });

  it('5~6년차 → 17일', () => {
    expect(calculateAnnualDays(5)).toBe(17);
    expect(calculateAnnualDays(6)).toBe(17);
  });

  it('21년 이상 → 25일 상한', () => {
    expect(calculateAnnualDays(21)).toBe(25);
    expect(calculateAnnualDays(30)).toBe(25);
    expect(calculateAnnualDays(50)).toBe(25);
  });

  it('2년마다 +1일 증가 패턴', () => {
    // 1→15, 3→16, 5→17, 7→18, 9→19, 11→20, 13→21, 15→22, 17→23, 19→24, 21→25
    expect(calculateAnnualDays(7)).toBe(18);
    expect(calculateAnnualDays(9)).toBe(19);
    expect(calculateAnnualDays(11)).toBe(20);
    expect(calculateAnnualDays(13)).toBe(21);
    expect(calculateAnnualDays(15)).toBe(22);
    expect(calculateAnnualDays(17)).toBe(23);
    expect(calculateAnnualDays(19)).toBe(24);
  });
});

describe('calculateTenureYears', () => {
  it('입사 직후 → 0년', () => {
    const hire = new Date('2026-01-01');
    const asOf = new Date('2026-01-02');
    expect(calculateTenureYears(hire, asOf)).toBe(0);
  });

  it('입사 1년 정확 → 1년', () => {
    const hire = new Date('2025-01-01');
    const asOf = new Date('2026-01-01');
    expect(calculateTenureYears(hire, asOf)).toBe(1);
  });

  it('입사 후 5년 1개월 → 5년 (내림)', () => {
    const hire = new Date('2021-01-01');
    const asOf = new Date('2026-02-01');
    expect(calculateTenureYears(hire, asOf)).toBe(5);
  });

  it('입사일이 미래면 0', () => {
    const hire = new Date('2027-01-01');
    const asOf = new Date('2026-01-01');
    expect(calculateTenureYears(hire, asOf)).toBe(0);
  });
});
