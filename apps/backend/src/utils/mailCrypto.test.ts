import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptMailPassword,
  decryptMailPassword,
  generateStrongPassword,
} from './mailCrypto';

// setup.ts에서 이미 process.env.MAIL_ENCRYPTION_KEY 주입됨 필요
// 없으면 테스트용 키 주입
beforeEach(() => {
  if (!process.env.MAIL_ENCRYPTION_KEY) {
    process.env.MAIL_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }
});

describe('encrypt/decrypt', () => {
  it('평문 → 암호문 → 원문 복원', () => {
    const plain = 'MySecret@123';
    const enc = encryptMailPassword(plain);
    const dec = decryptMailPassword(enc);
    expect(dec).toBe(plain);
  });

  it('같은 평문도 매번 다른 암호문 (IV 랜덤)', () => {
    const plain = 'same-input';
    const a = encryptMailPassword(plain);
    const b = encryptMailPassword(plain);
    expect(a).not.toBe(b);
    expect(decryptMailPassword(a)).toBe(plain);
    expect(decryptMailPassword(b)).toBe(plain);
  });

  it('한글/유니코드 지원', () => {
    const plain = '한글비밀번호🔒';
    const enc = encryptMailPassword(plain);
    expect(decryptMailPassword(enc)).toBe(plain);
  });

  it('빈 문자열은 에러', () => {
    expect(() => encryptMailPassword('')).toThrow();
  });

  it('변조된 암호문은 복호화 실패 (GCM auth tag)', () => {
    const enc = encryptMailPassword('original');
    const [iv, tag, ct] = enc.split(':');
    const tampered = `${iv}:${tag}:${ct.slice(0, -2)}00`;
    expect(() => decryptMailPassword(tampered)).toThrow();
  });

  it('잘못된 포맷은 에러', () => {
    expect(() => decryptMailPassword('invalid')).toThrow();
    expect(() => decryptMailPassword('only:two')).toThrow();
  });

  it('암호문에 iv:tag:ciphertext 세 부분 존재', () => {
    const enc = encryptMailPassword('test');
    expect(enc.split(':').length).toBe(3);
  });
});

describe('generateStrongPassword', () => {
  it('기본 길이 16', () => {
    const pw = generateStrongPassword();
    expect(pw).toHaveLength(16);
  });

  it('지정 길이', () => {
    expect(generateStrongPassword(24)).toHaveLength(24);
  });

  it('항상 대/소/숫자/특수 각 1개 이상', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateStrongPassword();
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/\d/.test(pw)).toBe(true);
      expect(/[!@#$%^&*\-_=+]/.test(pw)).toBe(true);
    }
  });

  it('가독성 혼동 문자 제외 (I, O, l, 0, 1)', () => {
    // 충분히 많이 생성해도 금지 문자가 나오지 않아야 함
    for (let i = 0; i < 50; i++) {
      const pw = generateStrongPassword();
      expect(pw).not.toMatch(/[IOl01]/);
    }
  });

  it('매번 다른 결과', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(generateStrongPassword());
    expect(seen.size).toBe(20);
  });
});
