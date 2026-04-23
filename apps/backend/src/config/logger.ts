import pino from 'pino';
import { config } from './index';

/**
 * 구조화된 JSON 로거 (pino)
 *
 * - 개발: pino-pretty가 설치되어 있으면 보기 좋게 출력 (기본: 없어도 JSON으로 출력)
 * - 프로덕션: JSON으로 출력 → Docker 로그/CloudWatch/Loki 등에서 바로 파싱 가능
 * - 민감 필드(password, token, secret)는 자동 마스킹
 */

const isDev = !config.isProd;

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // 민감 정보 자동 마스킹
  redact: {
    paths: [
      'password',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ],
    censor: '[REDACTED]',
  },
  // 개발 환경에서만 pino-pretty 시도 (미설치여도 JSON으로 동작)
  ...(isDev && tryLoadPrettyTransport()
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }
    : {}),
});

function tryLoadPrettyTransport(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    return false;
  }
}
