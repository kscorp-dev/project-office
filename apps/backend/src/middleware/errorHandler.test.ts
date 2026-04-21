import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';

// logger는 noop mock
vi.mock('../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// config는 isProd 기본 false
vi.mock('../config', () => ({
  config: { isProd: false },
}));

import { errorHandler, notFoundHandler } from './errorHandler';
import { AppError } from '../services/auth.service';
import { config } from '../config';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/test',
    method: 'POST',
    user: { id: 'u1', role: 'user' },
    ...overrides,
  } as Request;
}

function makeRes(headersSent = false): { res: Response; status: any; json: any } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json, headersSent } as unknown as Response;
  return { res, status, json };
}

describe('notFoundHandler', () => {
  it('404 응답 반환', () => {
    const req = makeReq({ method: 'GET', path: '/unknown' });
    const { res, status, json } = makeRes();
    notFoundHandler(req, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'NOT_FOUND' }),
    }));
  });
});

describe('errorHandler — AppError', () => {
  it('statusCode + code + message 그대로 반환', () => {
    const err = new AppError(403, 'FORBIDDEN', '권한이 없습니다');
    const { res, status, json } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: '권한이 없습니다' },
    });
  });

  it('404 AppError 처리', () => {
    const err = new AppError(404, 'NOT_FOUND', '없음');
    const { res, status } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(404);
  });
});

describe('errorHandler — ZodError', () => {
  it('400으로 details 포함 응답', () => {
    const schema = z.object({ email: z.string().email() });
    const parseResult = schema.safeParse({ email: 'not-an-email' });
    expect(parseResult.success).toBe(false);

    const err = (parseResult as any).error as ZodError;
    const { res, status, json } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);

    expect(status).toHaveBeenCalledWith(400);
    const payload = json.mock.calls[0][0];
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(payload.error.details)).toBe(true);
    expect(payload.error.details[0]).toEqual(expect.objectContaining({ path: 'email' }));
  });
});

describe('errorHandler — Prisma', () => {
  it('P2002 → 409 DUPLICATE', () => {
    const err = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: '5',
      meta: { target: ['email'] },
    });
    const { res, status, json } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'DUPLICATE' }),
    }));
  });

  it('P2025 → 404 NOT_FOUND', () => {
    const err = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: '5',
    });
    const { res, status } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(404);
  });

  it('P2003 → 400 FK_CONSTRAINT', () => {
    const err = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: '5',
    });
    const { res, status } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('매핑되지 않은 Prisma 코드 → 500으로 fallthrough', () => {
    const err = new Prisma.PrismaClientKnownRequestError('other', {
      code: 'P9999' as any,
      clientVersion: '5',
    });
    const { res, status } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
  });
});

describe('errorHandler — 일반 에러', () => {
  beforeEach(() => {
    (config as any).isProd = false;
  });

  it('개발 환경: detail 포함한 500', () => {
    const err = new Error('예상치 못한 오류');
    const { res, status, json } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
    const payload = json.mock.calls[0][0];
    expect(payload.error.code).toBe('INTERNAL');
    expect(payload.error.detail).toBe('예상치 못한 오류');
  });

  it('프로덕션: detail 은닉', () => {
    (config as any).isProd = true;
    const err = new Error('민감한 stack trace');
    const { res, status, json } = makeRes();
    errorHandler(err, makeReq(), res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
    const payload = json.mock.calls[0][0];
    expect(payload.error.detail).toBeUndefined();
  });

  it('응답이 이미 시작된 경우 next(err)로 위임', () => {
    const err = new Error('too late');
    const { res, status } = makeRes(true);
    const next = vi.fn() as NextFunction;
    errorHandler(err, makeReq(), res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
  });
});
