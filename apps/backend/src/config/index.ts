import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

/**
 * 필수 환경변수 검증 — 누락 시 서버 시작 거부
 * 프로덕션에서는 안전한 기본값 절대 금지
 */
function requireEnv(key: string, devFallback?: string): string {
  const value = process.env[key];
  if (value && value.trim().length > 0) return value;
  if (!isProd && devFallback !== undefined) {
    // 개발 환경에서만 fallback 허용
    console.warn(`[config] ⚠️  ${key} 미설정 — 개발용 fallback 사용 (프로덕션 배포 시 반드시 환경변수 지정 필요)`);
    return devFallback;
  }
  throw new Error(
    `[config] 필수 환경변수 누락: ${key}\n` +
    `프로덕션 환경에서는 ${key}를 반드시 지정해야 합니다.`,
  );
}

const jwtAccessSecret = requireEnv('JWT_ACCESS_SECRET', 'dev-access-secret-change-in-production');
const jwtRefreshSecret = requireEnv('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production');

// 시크릿 길이 검증 (최소 32자)
if (isProd) {
  if (jwtAccessSecret.length < 32) {
    throw new Error('[config] JWT_ACCESS_SECRET은 32자 이상이어야 합니다.');
  }
  if (jwtRefreshSecret.length < 32) {
    throw new Error('[config] JWT_REFRESH_SECRET은 32자 이상이어야 합니다.');
  }
  if (jwtAccessSecret === jwtRefreshSecret) {
    throw new Error('[config] JWT_ACCESS_SECRET과 JWT_REFRESH_SECRET은 서로 달라야 합니다.');
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProd,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  jwt: {
    accessSecret: jwtAccessSecret,
    refreshSecret: jwtRefreshSecret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10),
  },

  bcrypt: {
    saltRounds: 12,
  },

  rateLimit: {
    login: { windowMs: 15 * 60 * 1000, max: 5 },
    register: { windowMs: 60 * 60 * 1000, max: 3 },
    api: { windowMs: 60 * 1000, max: 100 },
  },

  password: {
    minLength: 8,
    maxLength: 100,
    historyCount: 5,
    maxLoginAttempts: 5,
    lockDurationMinutes: 15,
  },
} as const;
