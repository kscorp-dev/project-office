import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * Origin/Referer 기반 CSRF 방어 (depth-in-defense)
 *
 * JWT Bearer 토큰은 httpOnly 쿠키가 아니므로 전통적 CSRF 영향은 낮지만,
 * 장래에 refreshToken이 쿠키로 이동할 수 있고, 공격자가 XHR로 Authorization을
 * 위조할 수 있는 환경(토큰 도난 + CSRF 결합)을 위해 Origin 화이트리스트 검증을 둔다.
 *
 * 정책:
 * - GET/HEAD/OPTIONS 등 안전한 메서드는 검사 안 함
 * - state-changing 메서드(POST/PUT/PATCH/DELETE)는 Origin 또는 Referer가
 *   CORS_ORIGIN 화이트리스트에 매칭되어야 통과
 * - Origin이 아예 없는 경우 (서버-간 호출, curl)는 통과 — API 키/토큰으로 보호
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseAllowList(corsOrigin: string): string[] {
  return corsOrigin
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter((s) => s.length > 0 && s !== '*');
}

function normalizeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function originCheck(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const allowList = parseAllowList(config.corsOrigin);
  // CORS_ORIGIN이 '*'이면 이 미들웨어는 실질적으로 비활성화 (개발 환경 편의)
  if (allowList.length === 0) {
    next();
    return;
  }

  const origin = normalizeOrigin(req.headers.origin as string | undefined);
  const referer = normalizeOrigin(req.headers.referer as string | undefined);

  // 브라우저가 Origin/Referer 중 하나는 보내므로, 둘 다 없으면 서버-간 호출로 간주
  if (!origin && !referer) {
    next();
    return;
  }

  const candidate = origin ?? referer!;
  if (allowList.includes(candidate)) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: { code: 'CSRF_BLOCKED', message: '요청 출처가 유효하지 않습니다' },
  });
}
