/**
 * 통합 알림 REST API
 *
 * - GET    /notifications              — 목록 (?page, ?limit, ?unreadOnly=true)
 * - GET    /notifications/unread-count — 미확인 갯수
 * - PATCH  /notifications/:id/read     — 읽음 처리
 * - POST   /notifications/mark-all-read — 모두 읽음
 */
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  listNotifications,
  countUnread,
  markAsRead,
  markAllAsRead,
} from '../services/notification.service';
import { qs } from '../utils/query';

const router = Router();

// GET /notifications
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const unreadOnly = qs(req.query.unreadOnly) === 'true';

    const result = await listNotifications(req.user!.id, { page, limit, unreadOnly });
    res.json({
      success: true,
      data: result.rows,
      meta: {
        total: result.total,
        unread: result.unread,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /notifications/unread-count
router.get('/unread-count', authenticate, async (req: Request, res: Response) => {
  try {
    const count = await countUnread(req.user!.id);
    res.json({ success: true, data: { count } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', authenticate, async (req: Request, res: Response) => {
  try {
    const ok = await markAsRead(qs(req.params.id), req.user!.id);
    if (!ok) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '알림을 찾을 수 없거나 이미 읽음 처리되었습니다' },
      });
      return;
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /notifications/mark-all-read
router.post('/mark-all-read', authenticate, async (req: Request, res: Response) => {
  try {
    const count = await markAllAsRead(req.user!.id);
    res.json({ success: true, data: { updated: count } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
