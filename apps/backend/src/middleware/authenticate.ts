import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/prisma';

export interface JwtPayload {
  sub: string;
  role: string;
  deptId?: string;
  deviceId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        departmentId?: string;
        deviceId?: string;
      };
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '인증 토큰이 필요합니다' },
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '인증 토큰이 비어있습니다' },
    });
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
  } catch (err) {
    // JWT 전용 에러만 명시적으로 401로 처리한다.
    // 그 외 (예: 시크릿 설정 오류, 알 수 없는 예외)는 글로벌 핸들러로 넘긴다.
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: '토큰이 만료되었습니다' },
      });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: '유효하지 않은 토큰입니다' },
      });
      return;
    }
    return next(err);
  }

  // sub 필드 최소 검증 (페이로드 조작 방지)
  if (!decoded || typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: '토큰 페이로드가 유효하지 않습니다' },
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, role: true, status: true, departmentId: true },
    });

    if (!user || user.status !== 'active') {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: '유효하지 않은 사용자입니다' },
      });
      return;
    }

    req.user = {
      id: user.id,
      role: user.role,
      departmentId: user.departmentId ?? undefined,
      deviceId: decoded.deviceId,
    };

    return next();
  } catch (err) {
    // DB 조회 오류 등 예상치 못한 문제는 글로벌 에러 핸들러로 위임
    return next(err);
  }
}
