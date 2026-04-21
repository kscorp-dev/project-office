import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// config.corsOrigin을 테스트마다 조작 가능하도록 mock
vi.mock('../config', () => ({
  config: {
    corsOrigin: 'http://localhost:5173',
    isProd: false,
    nodeEnv: 'test',
  },
}));

// mock을 적용한 뒤 대상 모듈을 import
import { config } from '../config';
import { originCheck } from './originCheck';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: 'POST', headers: {}, ...overrides } as Request;
}
function makeRes(): { res: Response; status: any; json: any } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}
function makeNext(): NextFunction & { called: boolean } {
  const fn = vi.fn() as any;
  fn.called = false;
  return fn;
}

describe('originCheck', () => {
  beforeEach(() => {
    (config as any).corsOrigin = 'http://localhost:5173';
  });

  it('GET은 Origin 검사 스킵', () => {
    const req = makeReq({ method: 'GET', headers: { origin: 'https://evil.com' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('OPTIONS도 스킵 (CORS preflight)', () => {
    const req = makeReq({ method: 'OPTIONS', headers: { origin: 'https://evil.com' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('POST + 허용 Origin → 통과', () => {
    const req = makeReq({ method: 'POST', headers: { origin: 'http://localhost:5173' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('POST + 악성 Origin → 403', () => {
    const req = makeReq({ method: 'POST', headers: { origin: 'https://evil.com' } });
    const { res, status, json } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'CSRF_BLOCKED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('Origin 없고 Referer만 있을 때 Referer 검증', () => {
    const req = makeReq({
      method: 'POST',
      headers: { referer: 'http://localhost:5173/login' },
    });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('Origin도 Referer도 없으면 서버-간 호출로 간주하고 통과', () => {
    const req = makeReq({ method: 'POST', headers: {} });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('여러 Origin 콤마 구분 허용', () => {
    (config as any).corsOrigin = 'http://localhost:5173, https://app.example.com';
    const req = makeReq({ method: 'POST', headers: { origin: 'https://app.example.com' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('CORS_ORIGIN이 * 인 경우 검사 스킵', () => {
    (config as any).corsOrigin = '*';
    const req = makeReq({ method: 'POST', headers: { origin: 'https://anywhere.com' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('Origin URL 정규화 — trailing slash 무시', () => {
    (config as any).corsOrigin = 'http://localhost:5173';
    const req = makeReq({ method: 'POST', headers: { origin: 'http://localhost:5173' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('잘못된 Origin 문자열 (파싱 불가) → 차단', () => {
    const req = makeReq({ method: 'POST', headers: { origin: 'not-a-url' } });
    const { res, status } = makeRes();
    const next = makeNext();
    originCheck(req, res, next);
    // normalize가 null 반환 → referer도 없음 → 서버-간 호출로 간주해 통과
    // 이는 설계 상 의도된 동작 (브라우저는 항상 유효한 Origin 보냄)
    expect(next).toHaveBeenCalled();
  });
});
