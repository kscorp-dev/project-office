/**
 * 내부 서비스 웹훅 인증
 *
 * 사용처: detection 서버 → 백엔드 간 신뢰 경계.
 * 환경변수 `PARKING_WEBHOOK_SECRET` 등 웹훅별 시크릿을 발급받아
 * 호출 측은 `X-Webhook-Secret` 헤더에 실어 호출한다.
 *
 * 원칙:
 *   1) 시크릿 미설정 → 웹훅 엔드포인트 자체 비활성 (503). 운영자의 설정 누락을
 *      "인증 없는 통과"로 오인하지 않도록 fail-close.
 *   2) 헤더 값 비교는 timing-safe 로 (crypto.timingSafeEqual).
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../config/logger';

/** 타이밍 공격을 방지하는 시크릿 비교 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * 웹훅 시크릿 검증 미들웨어 팩토리.
 * @param envKey 환경변수 이름 (예: 'PARKING_WEBHOOK_SECRET')
 */
export function webhookAuth(envKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env[envKey];
    if (!expected) {
      logger.warn({ envKey, path: req.path }, '웹훅 시크릿 미설정으로 엔드포인트 비활성');
      res.status(503).json({
        success: false,
        error: {
          code: 'WEBHOOK_DISABLED',
          message: '웹훅이 비활성화되어 있습니다 (서버에 시크릿이 설정되지 않음)',
        },
      });
      return;
    }

    const provided = (req.headers['x-webhook-secret'] as string | undefined)?.trim();
    if (!provided || !safeEqual(provided, expected)) {
      logger.warn({ envKey, ip: req.ip, path: req.path }, '잘못된 웹훅 시크릿');
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_UNAUTHORIZED', message: '웹훅 인증 실패' },
      });
      return;
    }

    next();
  };
}
