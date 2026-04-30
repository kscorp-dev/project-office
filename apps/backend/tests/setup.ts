/**
 * Vitest 전역 setup
 *
 * - NODE_ENV=test 설정
 * - .env 로드 (DATABASE_URL 등)
 * - 테스트용 JWT 시크릿 주입 (config의 프로덕션 검증 통과용)
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-at-least-32-characters';
// 테스트에서는 Expo Push SDK 실제 호출 차단 — push.service 가 noop 반환
process.env.DISABLE_PUSH = 'true';
