import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { logger } from '../config/logger';

/**
 * 모듈 활성화 여부 확인 미들웨어 (fail-close 정책)
 *
 * - DB 정상 + 모듈 활성 → next()
 * - DB 정상 + 모듈 비활성 → 403 MODULE_DISABLED
 * - DB 조회 실패 → 503 MODULE_CHECK_FAILED (과거: fail-open 으로 통과 → 수정)
 *   DB 장애 상황에서도 보호된 라우트는 차단된 상태를 유지해야 한다.
 *
 * 사용 시 주의: 이 미들웨어는 인증을 대체하지 않는다.
 * 보호 라우트는 `router.use(authenticate, checkModule('xxx'))` 순서로 연결할 것.
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
    } catch (err) {
      // fail-close: DB 장애 시 통과시키지 않고 503 반환
      logger.error({ err, moduleName }, 'checkModule DB error');
      res.status(503).json({
        success: false,
        error: {
          code: 'MODULE_CHECK_FAILED',
          message: '모듈 상태 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        },
      });
    }
  };
}
