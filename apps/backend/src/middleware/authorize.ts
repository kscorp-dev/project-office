import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 5,
  admin: 4,
  dept_admin: 3,
  user: 2,
  guest: 1,
};

/**
 * 특정 역할 이상만 접근 허용
 */
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' },
      });
      return;
    }

    const userRole = req.user.role as UserRole;

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' },
      });
      return;
    }

    next();
  };
}

/**
 * 최소 역할 등급 이상만 접근 허용
 */
export function authorizeMinRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' },
      });
      return;
    }

    const userLevel = ROLE_HIERARCHY[req.user.role as UserRole] || 0;
    const minLevel = ROLE_HIERARCHY[minRole];

    if (userLevel < minLevel) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' },
      });
      return;
    }

    next();
  };
}
