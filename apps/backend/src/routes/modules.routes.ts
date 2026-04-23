/**
 * 기능 모듈 상태 조회 — 로그인한 모든 사용자용
 *
 * 관리자용 /admin/modules 과 달리 활성 여부만 필요한 프론트엔드 네비게이션
 * 필터링용 엔드포인트. admin-only 가드를 우회해 일반 사용자도 "어떤 모듈이
 * 켜져 있나" 만 알 수 있다 (isCritical/id 등 민감 메타 제외).
 */
import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { logger } from '../config/logger';

const router = Router();

router.use(authenticate);

// GET /api/modules — { data: { name: string; isEnabled: boolean }[] }
router.get('/', async (_req: Request, res: Response) => {
  try {
    const modules = await prisma.featureModule.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true, isEnabled: true },
    });
    res.json({ success: true, data: modules });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
