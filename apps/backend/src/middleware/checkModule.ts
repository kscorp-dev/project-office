import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';

/**
 * 모듈 활성화 여부 확인 미들웨어
 */
export function checkModule(moduleName: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const module = await prisma.featureModule.findUnique({
        where: { name: moduleName },
      });

      if (!module || !module.isEnabled) {
        res.status(403).json({
          success: false,
          error: {
            code: 'MODULE_DISABLED',
            message: `${moduleName} 모듈이 비활성화되어 있습니다`,
          },
        });
        return;
      }

      next();
    } catch {
      next();
    }
  };
}
