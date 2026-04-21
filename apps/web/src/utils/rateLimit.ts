import type { AxiosError } from 'axios';

/**
 * 429 Too Many Requests 응답에서 사용자 친화적 메시지를 생성한다.
 *
 * - Retry-After 헤더(초 단위)가 있으면 대략적인 대기 시간을 알려준다.
 * - 없으면 일반 안내 문구만 반환.
 */
export function parseRateLimitMessage(err: AxiosError | unknown): string | null {
  if (!isAxiosError(err)) return null;
  if (err.response?.status !== 429) return null;

  const retryAfter = err.response.headers?.['retry-after'];
  const seconds = retryAfter ? parseInt(String(retryAfter), 10) : NaN;

  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds < 60) return `요청이 너무 많습니다. ${seconds}초 후 다시 시도해주세요.`;
    const minutes = Math.ceil(seconds / 60);
    return `요청이 너무 많습니다. 약 ${minutes}분 후 다시 시도해주세요.`;
  }
  return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
}

function isAxiosError(err: unknown): err is AxiosError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'isAxiosError' in err &&
    (err as { isAxiosError: boolean }).isAxiosError === true
  );
}
