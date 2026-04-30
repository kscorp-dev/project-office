/**
 * 결재 위임/대결 REST 라우트
 *
 * GET    /approvals/delegations             — 내가 만든 위임 + 내가 받은 활성 위임
 * POST   /approvals/delegations             — 위임 생성 (toUser/start/end/reason)
 * DELETE /approvals/delegations/:id          — 위임 취소 (본인 또는 admin)
 *
 * 결재 자체의 승인/반려는 기존 /approvals/documents/:id/approve 가 위임 권한도 자동 인식.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createDelegation,
  listMyDelegations,
  listIncomingDelegations,
  cancelDelegation,
} from '../services/delegation.service';
import { logger } from '../config/logger';
import { AppError } from '../services/auth.service';

const router = Router();

router.use(authenticate);

const createSchema = z.object({
  toUserId: z.string().uuid(),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date'),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date'),
  reason: z.string().max(500).optional(),
});

// GET /approvals/delegations — 내가 만든 + 내가 받은
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [outgoing, incoming] = await Promise.all([
      listMyDelegations(userId),
      listIncomingDelegations(userId),
    ]);
    res.json({ success: true, data: { outgoing, incoming } });
  } catch (err) {
    logger.warn({ err, path: req.path }, 'list delegations failed');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '위임 조회 실패' } });
  }
});

// POST /approvals/delegations
router.post('/', validate(createSchema), async (req: Request, res: Response) => {
  try {
    const dlg = await createDelegation({
      fromUserId: req.user!.id,
      toUserId: req.body.toUserId,
      startDate: new Date(req.body.startDate),
      endDate: new Date(req.body.endDate),
      reason: req.body.reason,
    });
    res.status(201).json({ success: true, data: dlg });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    logger.warn({ err, path: req.path }, 'create delegation failed');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '위임 생성 실패' } });
  }
});

// DELETE /approvals/delegations/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const isAdmin = ['admin', 'super_admin'].includes(req.user!.role);
    await cancelDelegation(String(req.params.id), req.user!.id, isAdmin);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    logger.warn({ err, path: req.path }, 'cancel delegation failed');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '위임 취소 실패' } });
  }
});

export default router;
