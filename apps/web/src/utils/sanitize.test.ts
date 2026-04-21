/**
 * sanitizeHtml XSS 차단 테스트
 * jsdom 환경에서 실제 DOMPurify 동작 검증
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, stripHtml } from './sanitize';

describe('sanitizeHtml — 안전한 HTML 허용', () => {
  it('기본 텍스트 포매팅 태그 허용', () => {
    const clean = sanitizeHtml('<p>안녕하세요 <strong>굵게</strong> <em>기울임</em></p>');
    expect(clean).toContain('<p>');
    expect(clean).toContain('<strong>');
    expect(clean).toContain('<em>');
  });

  it('리스트 태그 허용', () => {
    const clean = sanitizeHtml('<ul><li>항목1</li><li>항목2</li></ul>');
    expect(clean).toContain('<ul>');
    expect(clean).toContain('<li>');
  });

  it('테이블 태그 허용', () => {
    const clean = sanitizeHtml('<table><tr><td>셀</td></tr></table>');
    expect(clean).toContain('<table>');
    expect(clean).toContain('<td>');
  });

  it('헤딩 태그 h1~h6 허용', () => {
    const clean = sanitizeHtml('<h1>제목</h1><h3>소제목</h3>');
    expect(clean).toContain('<h1>');
    expect(clean).toContain('<h3>');
  });

  it('안전한 링크는 유지하면서 target=_blank에 rel 자동 추가', () => {
    const clean = sanitizeHtml('<a href="https://example.com" target="_blank">click</a>');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});

describe('sanitizeHtml — XSS 공격 차단', () => {
  it('script 태그 제거', () => {
    const clean = sanitizeHtml('<script>alert("XSS")</script><p>본문</p>');
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('alert');
    expect(clean).toContain('<p>본문</p>');
  });

  it('이벤트 핸들러 (onclick/onerror) 제거', () => {
    const clean = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert');
  });

  it('onload 속성 제거', () => {
    const clean = sanitizeHtml('<body onload="alert(1)">텍스트</body>');
    expect(clean).not.toContain('onload');
  });

  it('javascript: URL 차단', () => {
    const clean = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(clean).not.toMatch(/href="javascript:/i);
  });

  it('iframe 제거', () => {
    const clean = sanitizeHtml('<iframe src="https://evil.com"></iframe>');
    expect(clean).not.toContain('<iframe');
  });

  it('object/embed 태그 제거', () => {
    const clean = sanitizeHtml('<object data="evil.swf"></object><embed src="evil.swf">');
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
  });

  it('form 태그 제거', () => {
    const clean = sanitizeHtml('<form action="/steal"><input name="pw" type="password"></form>');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
  });

  it('style 태그 제거 (CSS injection 방어)', () => {
    const clean = sanitizeHtml('<style>body { display: none; }</style>');
    expect(clean).not.toContain('<style');
  });

  it('null/undefined/빈 문자열 → 빈 문자열 반환', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });

  it('HTML 엔티티 인코딩된 script는 안전 (텍스트로 남음)', () => {
    const clean = sanitizeHtml('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(clean).not.toContain('<script>');
    // 엔티티는 그대로 또는 디코딩된 형태로 남음
  });

  it('SVG 내부 script 차단', () => {
    const clean = sanitizeHtml('<svg><script>alert(1)</script></svg>');
    expect(clean).not.toContain('alert');
  });

  it('data: URL은 이미지라도 차단 (기본 정책)', () => {
    const clean = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
    expect(clean).not.toMatch(/href="data:/i);
  });
});

describe('stripHtml — 모든 태그 제거', () => {
  it('태그 전부 제거하고 텍스트만 반환', () => {
    expect(stripHtml('<p>안녕<strong>하세요</strong></p>')).toBe('안녕하세요');
  });

  it('script 내용도 제거', () => {
    const result = stripHtml('<script>alert(1)</script>본문');
    expect(result).not.toContain('alert');
    expect(result).toContain('본문');
  });

  it('null/undefined → 빈 문자열', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });
});
