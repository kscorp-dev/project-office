import { describe, it, expect } from 'vitest';
import { parsePagination, buildMeta } from './pagination';

describe('parsePagination', () => {
  it('기본값 — 쿼리 없으면 page=1 limit=20', () => {
    const r = parsePagination({});
    expect(r).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('page/limit 문자열을 정수로 파싱', () => {
    const r = parsePagination({ page: '3', limit: '10' });
    expect(r).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it('defaultLimit 옵션 존중', () => {
    const r = parsePagination({}, { defaultLimit: 50 });
    expect(r.limit).toBe(50);
  });

  it('maxLimit를 초과하면 clamp', () => {
    const r = parsePagination({ limit: '9999' }, { maxLimit: 100 });
    expect(r.limit).toBe(100);
  });

  it('음수/0/NaN page → 1로 보정', () => {
    expect(parsePagination({ page: '-5' }).page).toBe(1);
    expect(parsePagination({ page: '0' }).page).toBe(1);
    expect(parsePagination({ page: 'abc' }).page).toBe(1);
  });

  it('음수/0 limit → defaultLimit로 보정', () => {
    expect(parsePagination({ limit: '-5' }).limit).toBe(20);
    expect(parsePagination({ limit: '0' }).limit).toBe(20);
  });

  it('배열/객체 query값은 기본값 처리', () => {
    expect(parsePagination({ page: ['1', '2'] as any }).page).toBe(1);
    expect(parsePagination({ limit: {} as any }).limit).toBe(20);
  });

  it('소수는 내림 (floor)', () => {
    const r = parsePagination({ page: '2.7', limit: '15.9' });
    expect(r.page).toBe(2);
    expect(r.limit).toBe(15);
  });

  it('skip 계산 정확성', () => {
    expect(parsePagination({ page: '1', limit: '20' }).skip).toBe(0);
    expect(parsePagination({ page: '2', limit: '20' }).skip).toBe(20);
    expect(parsePagination({ page: '5', limit: '10' }).skip).toBe(40);
  });
});

describe('buildMeta', () => {
  it('정수 나눔 — total 100 / limit 20 → 5페이지', () => {
    const m = buildMeta({ page: 1, limit: 20, skip: 0 }, 100);
    expect(m).toEqual({ total: 100, page: 1, limit: 20, totalPages: 5 });
  });

  it('올림 계산 — total 21 / limit 10 → 3페이지', () => {
    const m = buildMeta({ page: 1, limit: 10, skip: 0 }, 21);
    expect(m.totalPages).toBe(3);
  });

  it('total 0이어도 totalPages는 최소 1', () => {
    const m = buildMeta({ page: 1, limit: 20, skip: 0 }, 0);
    expect(m.totalPages).toBe(1);
  });
});
