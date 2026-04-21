import { describe, it, expect } from 'vitest';
import { parseRateLimitMessage } from './rateLimit';
import type { AxiosError } from 'axios';

function makeAxiosError(status: number, headers: Record<string, string> = {}): AxiosError {
  return {
    isAxiosError: true,
    response: { status, headers, data: {}, statusText: '', config: {} as any },
    message: '',
    name: 'AxiosError',
    config: {} as any,
    toJSON: () => ({}),
  } as AxiosError;
}

describe('parseRateLimitMessage', () => {
  it('axios error가 아니면 null', () => {
    expect(parseRateLimitMessage(new Error('not axios'))).toBeNull();
    expect(parseRateLimitMessage(null)).toBeNull();
    expect(parseRateLimitMessage(undefined)).toBeNull();
    expect(parseRateLimitMessage({ foo: 'bar' })).toBeNull();
  });

  it('429 이외 상태는 null', () => {
    expect(parseRateLimitMessage(makeAxiosError(400))).toBeNull();
    expect(parseRateLimitMessage(makeAxiosError(500))).toBeNull();
  });

  it('429 + Retry-After < 60초 → 초 단위 메시지', () => {
    const msg = parseRateLimitMessage(makeAxiosError(429, { 'retry-after': '30' }));
    expect(msg).toContain('30초');
  });

  it('429 + Retry-After >= 60초 → 분 단위 (올림)', () => {
    const msg = parseRateLimitMessage(makeAxiosError(429, { 'retry-after': '90' }));
    expect(msg).toContain('2분');
  });

  it('429 + Retry-After 900초 → 15분', () => {
    const msg = parseRateLimitMessage(makeAxiosError(429, { 'retry-after': '900' }));
    expect(msg).toContain('15분');
  });

  it('429 + Retry-After 누락 → 일반 안내', () => {
    const msg = parseRateLimitMessage(makeAxiosError(429));
    expect(msg).toContain('잠시 후');
  });

  it('429 + Retry-After가 숫자가 아니면 일반 안내', () => {
    const msg = parseRateLimitMessage(makeAxiosError(429, { 'retry-after': 'invalid' }));
    expect(msg).toContain('잠시 후');
  });

  it('429 + Retry-After가 0 이하면 일반 안내', () => {
    const msg = parseRateLimitMessage(makeAxiosError(429, { 'retry-after': '0' }));
    expect(msg).toContain('잠시 후');
    const msg2 = parseRateLimitMessage(makeAxiosError(429, { 'retry-after': '-10' }));
    expect(msg2).toContain('잠시 후');
  });
});
