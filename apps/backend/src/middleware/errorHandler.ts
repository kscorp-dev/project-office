import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../services/auth.service';
import { logger } from '../config/logger';
import { config } from '../config';

/**
 * 404 핸들러 (등록되지 않은 라우트)
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `경로를 찾을 수 없습니다: ${req.method} ${req.path}` },
  });
}

/**
 * 중앙 에러 핸들러
 *
 * 라우트에서 throw된 예외를 일관된 JSON 포맷으로 변환하고 로깅한다.
 * - AppError: 코드/메시지 그대로 사용
 * - ZodError: 400으로 상세 필드 에러 반환
 * - Prisma 에러: 상태 코드로 매핑
 * - 그 외: 500 (프로덕션에서 메시지 은닉)
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // 응답이 이미 시작되었으면 Express 기본 핸들러에 위임
  if (res.headersSent) {
    return _next(err);
  }

  // ---- AppError (우리가 던진 예외) ----
  if (err instanceof AppError) {
    logger.warn(
      { err: { code: err.code, message: err.message }, path: req.path, method: req.method, userId: req.user?.id },
      `[AppError] ${err.code}`,
    );
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // ---- Zod validation error ----
  if (err instanceof ZodError) {
    logger.warn({ issues: err.issues, path: req.path }, '[Validation] Zod error');
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '요청 형식이 올바르지 않습니다',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  // ---- Prisma 에러 ----
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: unique constraint violation
    // P2025: record not found (update/delete)
    // P2003: foreign key constraint
    const map: Record<string, { status: number; code: string; message: string }> = {
      P2002: { status: 409, code: 'DUPLICATE', message: '이미 존재하는 값입니다' },
      P2025: { status: 404, code: 'NOT_FOUND', message: '대상을 찾을 수 없습니다' },
      P2003: { status: 400, code: 'FK_CONSTRAINT', message: '참조 무결성 위반' },
    };
    const entry = map[err.code];
    if (entry) {
      logger.warn({ prismaCode: err.code, meta: err.meta, path: req.path }, `[Prisma] ${err.code}`);
      res.status(entry.status).json({
        success: false,
        error: { code: entry.code, message: entry.message },
      });
      return;
    }
  }

  // ---- 예상치 못한 에러 ----
  const error = err as Error;
  logger.error(
    {
      err: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      path: req.path,
      method: req.method,
      userId: req.user?.id,
    },
    '[Unhandled] Internal server error',
  );

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL',
      message: '서버 오류가 발생했습니다',
      // 프로덕션에서는 상세 내용 은닉
      ...(config.isProd ? {} : { detail: error.message }),
    },
  });
}
