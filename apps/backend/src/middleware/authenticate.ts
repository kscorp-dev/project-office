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

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '인증 토큰이 필요합니다' },
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;

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

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: '토큰이 만료되었습니다' },
      });
      return;
    }
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: '유효하지 않은 토큰입니다' },
    });
  }
}
