import crypto from 'crypto';

/**
 * 메일 계정 비밀번호 암복호화 (AES-256-GCM)
 *
 * 저장 포맷: iv(12B) + tag(16B) + ciphertext  모두 hex로 인코딩해 ':'으로 구분
 *
 * 키는 환경변수 MAIL_ENCRYPTION_KEY (32바이트 = 64 hex chars).
 * JWT 시크릿과 반드시 별개의 키를 사용.
 */

const KEY_ENV = 'MAIL_ENCRYPTION_KEY';
const ALGO = 'aes-256-gcm' as const;
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`환경변수 ${KEY_ENV}이(가) 설정되지 않았습니다`);
  }
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) {
    throw new Error(`${KEY_ENV}은(는) 64자 hex (32바이트)여야 합니다`);
  }
  cachedKey = buf;
  return buf;
}

export function encryptMailPassword(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('plaintext 비밀번호가 비어있습니다');
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptMailPassword(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('암호화 페이로드 형식이 올바르지 않습니다');
  }
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error('암호화 메타데이터 길이가 잘못되었습니다');
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * 강력한 WorkMail 기본 비밀번호 생성
 *
 * WorkMail 비밀번호 정책 (기본):
 *  - 8자 이상
 *  - 대/소문자, 숫자, 특수문자 각 1개 이상
 */
export function generateStrongPassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // I, O 제외 (가독성)
  const lower = 'abcdefghijkmnpqrstuvwxyz';   // l, o 제외
  const digit = '23456789';                   // 0, 1 제외
  const symb = '!@#$%^&*-_=+';
  const all = upper + lower + digit + symb;

  const bytes = crypto.randomBytes(length);
  const chars: string[] = [];
  // 최소 4개 요구조건 먼저 배치
  chars.push(upper[bytes[0] % upper.length]);
  chars.push(lower[bytes[1] % lower.length]);
  chars.push(digit[bytes[2] % digit.length]);
  chars.push(symb[bytes[3] % symb.length]);
  // 나머지는 전체 풀에서 랜덤
  for (let i = 4; i < length; i++) {
    chars.push(all[bytes[i] % all.length]);
  }
  // 피셔-예이츠 셔플
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
