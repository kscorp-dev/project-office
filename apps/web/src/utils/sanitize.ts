/**
 * HTML sanitize 유틸리티
 *
 * dangerouslySetInnerHTML로 렌더링하는 모든 사용자 작성 HTML은
 * 반드시 이 유틸을 거쳐야 XSS 공격을 차단할 수 있다.
 *
 * 사용 예:
 *   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }} />
 */
import DOMPurify, { type Config } from 'dompurify';

// 결재/게시판 본문에 허용되는 태그/속성 화이트리스트
// 마크업 편집기가 보통 생성하는 태그만 열어두고 <script>/<iframe>/on*= 이벤트 핸들러는 전부 차단
const DEFAULT_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'u', 's', 'b', 'i',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img',
    'blockquote', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'div', 'span',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel',
    'src', 'alt', 'title',
    'class', 'style',
    'colspan', 'rowspan',
  ],
  // javascript: / data:(응용) URL 차단
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^:]*$)/i,
  // 자바스크립트 리턴값으로 이벤트 핸들러 주입 차단
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

/**
 * HTML을 XSS로부터 안전한 형태로 정제한다.
 * 모든 외부 링크는 자동으로 rel="noopener noreferrer"가 추가된다.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';

  // target="_blank"인 <a>에 rel="noopener noreferrer" 강제 추가 (DOM 후처리)
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  const clean = DOMPurify.sanitize(dirty, DEFAULT_CONFIG) as unknown as string;

  // hook은 전역이므로 사용 후 제거
  DOMPurify.removeAllHooks();

  return clean;
}

/**
 * 일반 텍스트로 변환 (모든 HTML 태그 제거).
 * 미리보기/요약용.
 */
export function stripHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as unknown as string;
}
