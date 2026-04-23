/**
 * 캘린더 외부 동기화 REST API (v0.16.0 Phase 1)
 *
 * JWT 인증 필요:
 *   GET    /calendar-sync/subscriptions              — 내 구독 목록
 *   POST   /calendar-sync/subscriptions              — 신규 구독 생성
 *   PATCH  /calendar-sync/subscriptions/:id          — 옵션 변경
 *   POST   /calendar-sync/subscriptions/:id/regenerate — 토큰 회전
 *   DELETE /calendar-sync/subscriptions/:id          — 폐기
 *
 * 공개 (토큰 자체가 인증):
 *   GET /calendar-sync/feed/:token.ics               — iCalendar feed
 *     - OS 캘린더 앱이 주기적으로 pull
 *     - Content-Type: text/calendar; charset=utf-8
 *     - ETag / If-None-Match 기반 304 지원
 *     - rate limit 완화 (정상 폴링 대응)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { qs } from '../utils/query';
import { AppError } from '../services/auth.service';
import { logger } from '../config/logger';
import {
  createSubscription,
  listSubscriptionsForUser,
  updateSubscription,
  revokeSubscription,
  regenerateSubscriptionToken,
  findSubscriptionByToken,
  renderIcsForSubscription,
  saveSubscriptionEtag,
} from '../services/calendar-sync.service';
import {
  getAuthorizationUrl,
  handleOAuthCallback,
  disconnectGoogle,
  pullEventsFromGoogle,
  getSyncStatus,
} from '../services/google-calendar.service';
import { config } from '../config';

const router = Router();

// ── 구독 CRUD ──

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['personal', 'personal_dept', 'all']).default('personal'),
  includeVacation: z.boolean().default(true),
  includeMeeting: z.boolean().default(true),
  includeTasks: z.boolean().default(false),
  reminderMinutes: z.array(z.number().int().min(0).max(1440)).max(5).default([10]),
});

router.post('/subscriptions', authenticate, validate(createSchema), async (req: Request, res: Response) => {
  try {
    const sub = await createSubscription({ userId: req.user!.id, ...req.body });
    res.status(201).json({
      success: true,
      data: { ...sub, feedUrl: buildFeedUrl(req, sub.token) },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.get('/subscriptions', authenticate, async (req: Request, res: Response) => {
  try {
    const rows = await listSubscriptionsForUser(req.user!.id);
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, feedUrl: buildFeedUrl(req, r.token) })),
    });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

const patchSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

router.patch(
  '/subscriptions/:id',
  authenticate,
  validate(patchSchema),
  async (req: Request, res: Response) => {
    try {
      const sub = await updateSubscription(qs(req.params.id), req.user!.id, req.body);
      res.json({
        success: true,
        data: { ...sub, feedUrl: buildFeedUrl(req, sub.token) },
      });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

router.post('/subscriptions/:id/regenerate', authenticate, async (req: Request, res: Response) => {
  try {
    const sub = await regenerateSubscriptionToken(qs(req.params.id), req.user!.id);
    res.json({
      success: true,
      data: { ...sub, feedUrl: buildFeedUrl(req, sub.token) },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.delete('/subscriptions/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await revokeSubscription(qs(req.params.id), req.user!.id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ── 공개 Feed 엔드포인트 ──

// OS 캘린더 앱이 주기적 폴링 — rate limit 여유 있게 (IP당 5분에 60회)
const feedLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /calendar-sync/feed/:token.ics
 * 토큰 path parameter에서 `.ics` 확장자 제거 후 검증.
 */
router.get('/feed/:tokenFile', feedLimiter, async (req: Request, res: Response) => {
  try {
    const tokenFile = qs(req.params.tokenFile);
    const token = tokenFile.replace(/\.ics$/i, '');

    const sub = await findSubscriptionByToken(token);
    if (!sub) {
      res.status(404).type('text/plain').send('Not found or revoked');
      return;
    }

    const { ics, etag } = await renderIcsForSubscription(sub.id);
    const quotedEtag = `"${etag}"`;

    // If-None-Match 304 지원 — 네트워크/CPU 절약
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === quotedEtag) {
      res.status(304).end();
      return;
    }

    // 비동기로 ETag 저장 (log용)
    saveSubscriptionEtag(sub.id, etag).catch(() => { /* ignore */ });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=900'); // 15분
    res.setHeader('ETag', quotedEtag);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="project-office-${sub.user.name}.ics"`,
    );
    res.send(ics);
  } catch (err) {
    res.status(500).type('text/plain').send('Internal server error');
  }
});

// ===== Google Calendar OAuth 양방향 (v0.18.0 Phase 2) =====

// GET /calendar-sync/google/auth-url — 동의 화면 URL 생성
router.get('/google/auth-url', authenticate, (req: Request, res: Response) => {
  try {
    if (!config.google.enabled) {
      res.status(503).json({
        success: false,
        error: {
          code: 'GOOGLE_NOT_CONFIGURED',
          message: '서버에 Google OAuth가 설정되지 않았습니다 (GOOGLE_OAUTH_CLIENT_ID/SECRET 필요)',
        },
      });
      return;
    }
    const url = getAuthorizationUrl(req.user!.id);
    res.json({ success: true, data: { url } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /calendar-sync/google/callback?code=...&state=<userId>
// 공개 엔드포인트 — state로 사용자 식별 (CSRF는 state에 HMAC 추가로 강화 가능)
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = qs(req.query.code);
    const state = qs(req.query.state);
    if (!code || !state) {
      res.status(400).send('잘못된 요청입니다');
      return;
    }
    await handleOAuthCallback(code, state);
    // 성공 시 웹 앱의 설정 페이지로 리다이렉트
    const webUrl = config.systemMail.webUrl || 'http://localhost:5173';
    res.redirect(`${webUrl}/settings/calendar-sync?google=connected`);
  } catch (err) {
    const webUrl = config.systemMail.webUrl || 'http://localhost:5173';
    const msg = err instanceof AppError ? err.message : '연동 실패';
    res.redirect(`${webUrl}/settings/calendar-sync?google=error&message=${encodeURIComponent(msg)}`);
  }
});

// GET /calendar-sync/google/status — 내 연동 상태
router.get('/google/status', authenticate, async (req: Request, res: Response) => {
  try {
    const status = await getSyncStatus(req.user!.id);
    res.json({
      success: true,
      data: {
        connected: !!status && status.isActive,
        enabled: config.google.enabled,
        ...status,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /calendar-sync/google/sync — 수동 증분 동기화 (Google → 로컬)
router.post('/google/sync', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await pullEventsFromGoogle(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    logger.error({ err, userId: req.user?.id }, '캘린더 동기화 실패');
    res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: '동기화에 실패했습니다' },
    });
  }
});

// DELETE /calendar-sync/google — 연동 해제
router.delete('/google', authenticate, async (req: Request, res: Response) => {
  try {
    await disconnectGoogle(req.user!.id);
    res.json({ success: true });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ── 헬퍼 ──

function buildFeedUrl(req: Request, token: string): { https: string; webcal: string } {
  // 프로덕션에서는 config.systemMail.webUrl(WEB_URL)을 기본 도메인으로 사용
  const origin =
    process.env.PUBLIC_BASE_URL ||
    (config.systemMail.webUrl.startsWith('http') ? new URL(config.systemMail.webUrl).origin : '') ||
    `${req.protocol}://${req.get('host')}`;
  const apiPath = `/api/calendar-sync/feed/${token}.ics`;
  const httpsUrl = `${origin}${apiPath}`;
  // iOS 캘린더의 "구독 추가" 프롬프트를 자동으로 띄우는 webcal 스킴
  const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:');
  return { https: httpsUrl, webcal: webcalUrl };
}

export default router;
