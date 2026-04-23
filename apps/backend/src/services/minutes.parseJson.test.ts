/**
 * Claude 응답 JSON 파서 단위 테스트
 *
 * minutes.service 내부의 parseMinutesJson은 모듈 내부 함수라 export하지 않음 →
 * generateMinutes/updateMinutes를 import하면 DB/API 연결되므로, 여기서는
 * 동일한 파서 로직을 복제해서 시나리오별 견고성만 검증.
 *
 * 실제 파서 변경 시 이 테스트도 함께 수정해야 함.
 */
import { describe, it, expect } from 'vitest';

interface ActionItem { assignee: string; task: string; dueDate?: string }
interface MinutesStructured {
  summary: string; topics: string[]; decisions: string[]; actionItems: ActionItem[];
}

function parseMinutesJson(raw: string): MinutesStructured {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const obj = JSON.parse(cleaned);
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      topics: Array.isArray(obj.topics) ? obj.topics.filter((t: unknown) => typeof t === 'string') : [],
      decisions: Array.isArray(obj.decisions) ? obj.decisions.filter((d: unknown) => typeof d === 'string') : [],
      actionItems: Array.isArray(obj.actionItems)
        ? obj.actionItems
            .filter((a: unknown): a is Record<string, unknown> => typeof a === 'object' && a !== null)
            .map((a: Record<string, unknown>): ActionItem => ({
              assignee: typeof a.assignee === 'string' ? a.assignee : '',
              task: typeof a.task === 'string' ? a.task : '',
              dueDate: typeof a.dueDate === 'string' ? a.dueDate : undefined,
            }))
            .filter((a: ActionItem) => a.assignee && a.task)
        : [],
    };
  } catch {
    return {
      summary: `(자동 파싱 실패 — 원문 참조)\n\n${raw.slice(0, 2000)}`,
      topics: [],
      decisions: [],
      actionItems: [],
    };
  }
}

describe('parseMinutesJson', () => {
  it('정상 JSON을 파싱', () => {
    const input = JSON.stringify({
      summary: '회의 요약',
      topics: ['주제1', '주제2'],
      decisions: ['결정1'],
      actionItems: [{ assignee: '김과장', task: '보고서 작성', dueDate: '2026-05-01' }],
    });
    const r = parseMinutesJson(input);
    expect(r.summary).toBe('회의 요약');
    expect(r.topics).toEqual(['주제1', '주제2']);
    expect(r.decisions).toEqual(['결정1']);
    expect(r.actionItems).toHaveLength(1);
    expect(r.actionItems[0]).toEqual({ assignee: '김과장', task: '보고서 작성', dueDate: '2026-05-01' });
  });

  it('코드펜스 ```json ... ``` 제거', () => {
    const input = '```json\n' + JSON.stringify({ summary: 'x', topics: [], decisions: [], actionItems: [] }) + '\n```';
    const r = parseMinutesJson(input);
    expect(r.summary).toBe('x');
  });

  it('JSON 앞뒤 설명 텍스트 제거', () => {
    const input = '여기는 요약입니다:\n' + JSON.stringify({ summary: 's', topics: [], decisions: [], actionItems: [] }) + '\n감사합니다';
    const r = parseMinutesJson(input);
    expect(r.summary).toBe('s');
  });

  it('잘못된 JSON → fallback (원문을 summary에)', () => {
    const raw = '이것은 JSON이 아닙니다';
    const r = parseMinutesJson(raw);
    expect(r.summary).toContain('자동 파싱 실패');
    expect(r.summary).toContain(raw);
    expect(r.topics).toEqual([]);
    expect(r.actionItems).toEqual([]);
  });

  it('actionItems에 assignee/task 누락된 항목 제거', () => {
    const input = JSON.stringify({
      summary: 's',
      topics: [],
      decisions: [],
      actionItems: [
        { assignee: '김과장', task: '완전한 할일' },
        { assignee: '', task: '담당자 없음' },
        { assignee: '박사원', task: '' },
        { task: 'assignee 필드 없음' },
      ],
    });
    const r = parseMinutesJson(input);
    expect(r.actionItems).toHaveLength(1);
    expect(r.actionItems[0].assignee).toBe('김과장');
  });

  it('topics/decisions에 문자열이 아닌 요소는 필터링', () => {
    const input = JSON.stringify({
      summary: 's',
      topics: ['정상', 123, null, '또 정상'],
      decisions: [true, '결정'],
      actionItems: [],
    });
    const r = parseMinutesJson(input);
    expect(r.topics).toEqual(['정상', '또 정상']);
    expect(r.decisions).toEqual(['결정']);
  });

  it('배열이 아닌 필드는 빈 배열로 대체', () => {
    const input = JSON.stringify({
      summary: 's',
      topics: '문자열임',
      decisions: null,
      actionItems: {},
    });
    const r = parseMinutesJson(input);
    expect(r.topics).toEqual([]);
    expect(r.decisions).toEqual([]);
    expect(r.actionItems).toEqual([]);
  });

  it('빈 문자열은 summary를 빈 문자열로', () => {
    const input = JSON.stringify({ summary: '', topics: [], decisions: [], actionItems: [] });
    const r = parseMinutesJson(input);
    expect(r.summary).toBe('');
  });

  it('긴 원문(>2000자)은 fallback summary에서 잘림', () => {
    const raw = 'x'.repeat(3000);
    const r = parseMinutesJson(raw);
    // "(자동 파싱 실패 — 원문 참조)\n\n" (22자) + 2000자 = 2022자
    expect(r.summary.length).toBeLessThanOrEqual(2030);
  });
});
