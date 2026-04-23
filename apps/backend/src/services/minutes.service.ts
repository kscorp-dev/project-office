/**
 * 화상회의 회의록 자동 생성 서비스
 *
 * 흐름:
 *   1. 회의가 'ended' 상태로 전환되면 (REST end 엔드포인트) generateMinutes(meetingId) 호출
 *   2. MeetingTranscript 전체 조회 → Claude에 요약 요청 → MeetingMinutes upsert
 *   3. 상태: generating → draft (편집 가능) → final (잠금)
 *
 * API 키가 없는 환경(로컬/테스트)에서는 "ANTHROPIC_API_KEY 미설정" 메시지로 failed 상태 저장 →
 * 클라이언트에서 사용자에게 UI로 안내.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { config } from '../config';

// ── 타입 ──

export interface ActionItem {
  assignee: string;
  task: string;
  dueDate?: string; // ISO date
}

export interface MinutesStructured {
  summary: string;        // Markdown 요약 본문
  topics: string[];       // 주요 논의 주제
  decisions: string[];    // 결정 사항
  actionItems: ActionItem[];
}

// ── Claude 클라이언트 (lazy) ──
let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.anthropic.enabled) return null;
  if (!_client) _client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return _client;
}

// ── 프롬프트 ──
const SYSTEM_PROMPT = `당신은 한국 기업의 화상회의 회의록 작성 전문가입니다.
발언 기록(speaker, timestamp, text)을 분석하여 구조화된 회의록 JSON을 생성하세요.

**반드시 다음 JSON 형식으로만 응답하세요** (코드펜스 없이 순수 JSON):
{
  "summary": "회의 전체 요약 (2~4 단락, Markdown 허용)",
  "topics": ["주요 논의 주제 1", "주요 논의 주제 2", ...],
  "decisions": ["결정 사항 1", "결정 사항 2", ...],
  "actionItems": [
    { "assignee": "담당자 이름", "task": "할 일", "dueDate": "YYYY-MM-DD (선택)" }
  ]
}

규칙:
- 모든 텍스트는 한국어로
- 결정 사항은 실제 합의된 내용만 (추측 금지)
- 액션 아이템은 담당자가 명시된 것만 포함
- 잡담/인사말은 요약에서 제외`;

function buildUserPrompt(
  title: string,
  transcripts: Array<{ speakerName: string; text: string; timestamp: Date }>,
): string {
  const lines = transcripts.map((t) => {
    const ts = t.timestamp.toISOString().slice(11, 19); // HH:MM:SS
    return `[${ts}] ${t.speakerName}: ${t.text}`;
  });
  return `회의 제목: ${title}\n\n=== 발언 기록 ===\n${lines.join('\n')}\n\n위 회의를 분석하여 회의록 JSON을 생성하세요.`;
}

// ── 메인 함수 ──

/**
 * 회의 요약 생성 + DB 저장
 * - 이미 `generating`/`draft`/`final` 상태라면 덮어쓰지 않음 (단, regenerate=true면 재생성)
 * - API 키 미설정/실패 시 `failed` 상태 + errorMessage 저장하여 UI에서 원인 표시
 */
export async function generateMinutes(
  meetingId: string,
  opts: { regenerate?: boolean } = {},
): Promise<{ ok: true; minutesId: string } | { ok: false; reason: string }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, title: true, status: true },
  });
  if (!meeting) return { ok: false, reason: 'MEETING_NOT_FOUND' };

  // 이미 최종 확정된 회의록은 regenerate 없이는 덮어쓰지 않음
  const existing = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
  if (existing && existing.status === 'final' && !opts.regenerate) {
    return { ok: false, reason: 'ALREADY_FINALIZED' };
  }

  // upsert to generating state
  const minutes = await prisma.meetingMinutes.upsert({
    where: { meetingId },
    create: {
      meetingId,
      status: 'generating',
      summary: '',
      topics: [],
      decisions: [],
      actionItems: [],
    },
    update: {
      status: 'generating',
      errorMessage: null,
    },
  });

  // Claude 비활성 → failed
  const client = getClient();
  if (!client) {
    await prisma.meetingMinutes.update({
      where: { id: minutes.id },
      data: {
        status: 'failed',
        errorMessage: 'ANTHROPIC_API_KEY 미설정 — 자동 요약 비활성',
      },
    });
    return { ok: false, reason: 'ANTHROPIC_DISABLED' };
  }

  // 전사 수집
  const transcripts = await prisma.meetingTranscript.findMany({
    where: { meetingId },
    orderBy: { timestamp: 'asc' },
    select: { speakerName: true, text: true, timestamp: true },
  });

  if (transcripts.length === 0) {
    await prisma.meetingMinutes.update({
      where: { id: minutes.id },
      data: {
        status: 'failed',
        errorMessage: '저장된 발언 기록이 없어 요약을 생성할 수 없습니다',
      },
    });
    return { ok: false, reason: 'NO_TRANSCRIPTS' };
  }

  // Claude 호출
  try {
    const resp = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildUserPrompt(meeting.title, transcripts) },
      ],
    });

    // 텍스트 블록 추출
    const rawText = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const parsed = parseMinutesJson(rawText);

    await prisma.meetingMinutes.update({
      where: { id: minutes.id },
      data: {
        status: 'draft',
        summary: parsed.summary,
        topics: parsed.topics,
        decisions: parsed.decisions,
        actionItems: parsed.actionItems as unknown as Prisma.InputJsonValue,
        rawModelReply: rawText,
        generatedAt: new Date(),
        errorMessage: null,
      },
    });
    return { ok: true, minutesId: minutes.id };
  } catch (err) {
    const message = (err as Error)?.message || 'Claude API 오류';
    await prisma.meetingMinutes.update({
      where: { id: minutes.id },
      data: {
        status: 'failed',
        errorMessage: message.slice(0, 500),
      },
    });
    return { ok: false, reason: 'CLAUDE_ERROR' };
  }
}

/** Claude 응답 → MinutesStructured 파싱 (견고하게) */
function parseMinutesJson(raw: string): MinutesStructured {
  // 코드펜스가 섞여 있을 수 있음 — ```json ... ``` 제거
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  // 첫 `{`부터 마지막 `}`까지만 잘라내기 (서론/후기 제거)
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
    // 파싱 실패 시 빈 구조 + 원문을 summary에 넣어 사람이 수동 정리하도록
    return {
      summary: `(자동 파싱 실패 — 원문 참조)\n\n${raw.slice(0, 2000)}`,
      topics: [],
      decisions: [],
      actionItems: [],
    };
  }
}

// ── 편집/확정 ──

export async function updateMinutes(
  minutesId: string,
  patch: Partial<Pick<MinutesStructured, 'summary' | 'topics' | 'decisions' | 'actionItems'>>,
): Promise<void> {
  const data: Prisma.MeetingMinutesUpdateInput = {};
  if (patch.summary !== undefined) data.summary = patch.summary;
  if (patch.topics !== undefined) data.topics = patch.topics;
  if (patch.decisions !== undefined) data.decisions = patch.decisions;
  if (patch.actionItems !== undefined) {
    data.actionItems = patch.actionItems as unknown as Prisma.InputJsonValue;
  }
  await prisma.meetingMinutes.update({ where: { id: minutesId }, data });
}

export async function finalizeMinutes(minutesId: string, userId: string): Promise<void> {
  await prisma.meetingMinutes.update({
    where: { id: minutesId },
    data: {
      status: 'final',
      finalizedAt: new Date(),
      finalizedById: userId,
    },
  });
}
