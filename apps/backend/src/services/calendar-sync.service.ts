/**
 * 캘린더 외부 동기화 서비스 (v0.16.0 Phase 1 — ICS 구독 URL)
 *
 * 사용자의 Project Office 일정을 iCalendar(RFC 5545) 포맷으로 변환해
 * iOS/Android/Google/Outlook 등 외부 캘린더 앱이 주기적으로 pull할 수 있게 한다.
 *
 * VALARM 블록을 포함해 OS 캘린더 앱이 자체 알림을 등록하도록 유도
 *   → 알림을 별도 구현 불필요 (기획 §3.1 핵심 통찰)
 *
 * 데이터 소스:
 *  - CalendarEvent (scope='personal'은 본인만, 'personal_dept'는 소속 부서, 'all'은 전 회사)
 *  - Vacation (status='approved'인 본인 휴가)
 *  - Meeting (내가 host or invited or joined, status !== 'cancelled')
 *  - TaskOrder (내가 created or assigned, dueDate 있는 것)
 *
 * 범위: 과거 30일 ~ 미래 365일 (성능 + 보안)
 */
import crypto from 'crypto';
import ical, { ICalAlarmType, ICalCalendar, ICalEventBusyStatus } from 'ical-generator';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from './auth.service';

const PAST_WINDOW_DAYS = 30;
const FUTURE_WINDOW_DAYS = 365;
const ICS_PRODID = '-//KSCorp//Project Office//KO';

export interface CreateSubscriptionInput {
  userId: string;
  name: string;
  scope?: 'personal' | 'personal_dept' | 'all';
  includeVacation?: boolean;
  includeMeeting?: boolean;
  includeTasks?: boolean;
  reminderMinutes?: number[];
}

export interface UpdateSubscriptionInput {
  name?: string;
  scope?: 'personal' | 'personal_dept' | 'all';
  includeVacation?: boolean;
  includeMeeting?: boolean;
  includeTasks?: boolean;
  reminderMinutes?: number[];
  isActive?: boolean;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ── CRUD ──

export async function createSubscription(input: CreateSubscriptionInput) {
  // 최대 10개 구독 제한 (남용 방지)
  const count = await prisma.calendarSubscription.count({
    where: { userId: input.userId, isActive: true },
  });
  if (count >= 10) {
    throw new AppError(400, 'MAX_SUBSCRIPTIONS', '구독은 최대 10개까지만 가능합니다');
  }

  const sub = await prisma.calendarSubscription.create({
    data: {
      userId: input.userId,
      token: generateToken(),
      name: input.name.slice(0, 100),
      scope: input.scope ?? 'personal',
      includeVacation: input.includeVacation ?? true,
      includeMeeting: input.includeMeeting ?? true,
      includeTasks: input.includeTasks ?? false,
      reminderMinutes: sanitizeReminders(input.reminderMinutes ?? [10]),
    },
  });
  return sub;
}

export async function listSubscriptionsForUser(userId: string) {
  return prisma.calendarSubscription.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateSubscription(
  id: string,
  userId: string,
  patch: UpdateSubscriptionInput,
) {
  const existing = await prisma.calendarSubscription.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    throw new AppError(404, 'NOT_FOUND', '구독을 찾을 수 없습니다');
  }
  if (existing.revokedAt) {
    throw new AppError(400, 'REVOKED', '폐기된 구독은 수정할 수 없습니다');
  }

  const data: Prisma.CalendarSubscriptionUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name.slice(0, 100);
  if (patch.scope !== undefined) data.scope = patch.scope;
  if (patch.includeVacation !== undefined) data.includeVacation = patch.includeVacation;
  if (patch.includeMeeting !== undefined) data.includeMeeting = patch.includeMeeting;
  if (patch.includeTasks !== undefined) data.includeTasks = patch.includeTasks;
  if (patch.reminderMinutes !== undefined) data.reminderMinutes = sanitizeReminders(patch.reminderMinutes);
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  return prisma.calendarSubscription.update({ where: { id }, data });
}

/** 영구 폐기 — 이후 토큰 사용 시 401 */
export async function revokeSubscription(id: string, userId: string) {
  const existing = await prisma.calendarSubscription.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    throw new AppError(404, 'NOT_FOUND', '구독을 찾을 수 없습니다');
  }
  await prisma.calendarSubscription.update({
    where: { id },
    data: { isActive: false, revokedAt: new Date() },
  });
}

/** 토큰 회전 (유출 대응) — 기존 토큰 폐기 + 새 토큰 생성 */
export async function regenerateSubscriptionToken(id: string, userId: string) {
  const existing = await prisma.calendarSubscription.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    throw new AppError(404, 'NOT_FOUND', '구독을 찾을 수 없습니다');
  }
  if (existing.revokedAt) {
    throw new AppError(400, 'REVOKED', '폐기된 구독은 회전할 수 없습니다');
  }
  return prisma.calendarSubscription.update({
    where: { id },
    data: { token: generateToken() },
  });
}

// ── Feed 제공 (공개 엔드포인트에서 호출) ──

/**
 * 토큰으로 구독 조회 — 비활성/폐기 시 null
 * 동시에 lastAccessedAt / accessCount 업데이트 (비동기 fire-and-forget)
 */
export async function findSubscriptionByToken(token: string) {
  const sub = await prisma.calendarSubscription.findUnique({
    where: { token },
    include: {
      user: { select: { id: true, name: true, status: true, departmentId: true } },
    },
  });
  if (!sub || sub.revokedAt || !sub.isActive) return null;
  if (sub.user.status !== 'active') return null; // 퇴사자 자동 차단

  // 접근 로그 (비동기)
  prisma.calendarSubscription
    .update({
      where: { id: sub.id },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    })
    .catch(() => { /* ignore */ });

  return sub;
}

/**
 * ICS 렌더링 — 구독 옵션에 따라 이벤트 수집 후 iCalendar 포맷으로 반환
 * @returns { ics: string, etag: string }
 */
export async function renderIcsForSubscription(subId: string): Promise<{ ics: string; etag: string }> {
  const sub = await prisma.calendarSubscription.findUnique({
    where: { id: subId },
    include: {
      user: { select: { id: true, name: true, departmentId: true, email: true } },
    },
  });
  if (!sub) throw new AppError(404, 'NOT_FOUND', '구독을 찾을 수 없습니다');

  const now = new Date();
  const rangeStart = new Date(now.getTime() - PAST_WINDOW_DAYS * 24 * 3600 * 1000);
  const rangeEnd = new Date(now.getTime() + FUTURE_WINDOW_DAYS * 24 * 3600 * 1000);

  const cal = ical({
    prodId: ICS_PRODID,
    name: `Project Office - ${sub.user.name}`,
    timezone: 'Asia/Seoul',
    ttl: 60 * 15, // 15분 (외부 캘린더의 refresh 힌트)
  });

  // 1) CalendarEvent — scope에 따라 필터
  const calEventWhere: Prisma.CalendarEventWhereInput = {
    isActive: true,
    startDate: { gte: rangeStart, lte: rangeEnd },
  };
  if (sub.scope === 'personal') {
    calEventWhere.creatorId = sub.userId;
    calEventWhere.scope = 'personal';
  } else if (sub.scope === 'personal_dept') {
    calEventWhere.OR = [
      { creatorId: sub.userId, scope: 'personal' },
      { scope: 'department', departmentId: sub.user.departmentId ?? undefined },
      { scope: 'company' },
    ];
  } else {
    // 'all'
    calEventWhere.scope = { in: ['personal', 'department', 'company'] };
    if (sub.scope === 'all') {
      // 전사 보기지만 개인은 본인 것만
      calEventWhere.OR = [
        { creatorId: sub.userId, scope: 'personal' },
        { scope: { in: ['department', 'company'] } },
      ];
      delete calEventWhere.scope;
    }
  }

  const events = await prisma.calendarEvent.findMany({
    where: calEventWhere,
    select: {
      id: true, title: true, description: true,
      startDate: true, endDate: true, allDay: true,
      location: true, creatorId: true,
    },
  });
  for (const e of events) {
    addEventToCalendar(cal, {
      uid: `event-${e.id}@project-office`,
      start: e.startDate,
      end: e.endDate,
      allDay: e.allDay,
      summary: e.title,
      description: e.description ?? undefined,
      location: e.location ?? undefined,
      reminderMinutes: sub.reminderMinutes,
    });
  }

  // 2) Vacation — 본인 것, approved만
  if (sub.includeVacation) {
    const vacations = await prisma.vacation.findMany({
      where: {
        userId: sub.userId,
        status: 'approved',
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      select: {
        id: true, type: true, startDate: true, endDate: true, days: true, reason: true,
      },
    });
    for (const v of vacations) {
      addEventToCalendar(cal, {
        uid: `vacation-${v.id}@project-office`,
        start: v.startDate,
        end: v.endDate,
        allDay: true,
        summary: `휴가 (${vacationTypeLabel(v.type)})`,
        description: v.reason ?? undefined,
        reminderMinutes: sub.reminderMinutes,
      });
    }
  }

  // 3) Meeting — 내가 host/initiated or joined
  if (sub.includeMeeting) {
    const meetings = await prisma.meeting.findMany({
      where: {
        status: { in: ['scheduled', 'in_progress'] },
        scheduledAt: { gte: rangeStart, lte: rangeEnd },
        OR: [
          { hostId: sub.userId },
          { participants: { some: { userId: sub.userId } } },
        ],
      },
      select: {
        id: true, title: true, description: true, scheduledAt: true, roomCode: true, hostId: true,
      },
    });
    for (const m of meetings) {
      if (!m.scheduledAt) continue;
      const start = m.scheduledAt;
      const end = new Date(start.getTime() + 60 * 60 * 1000); // 기본 1시간
      addEventToCalendar(cal, {
        uid: `meeting-${m.id}@project-office`,
        start,
        end,
        allDay: false,
        summary: `[회의] ${m.title}`,
        description: m.description ?? undefined,
        location: `회의 코드: ${m.roomCode}`,
        reminderMinutes: sub.reminderMinutes,
      });
    }
  }

  // 4) TaskOrder — 마감일 있는 것 (옵션)
  if (sub.includeTasks) {
    const tasks = await prisma.taskOrder.findMany({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        OR: [
          { creatorId: sub.userId },
          { assignees: { some: { userId: sub.userId } } },
        ],
      },
      select: {
        id: true, title: true, taskNumber: true, dueDate: true, status: true,
      },
    });
    for (const t of tasks) {
      if (!t.dueDate) continue;
      addEventToCalendar(cal, {
        uid: `task-${t.id}@project-office`,
        start: t.dueDate,
        end: new Date(t.dueDate.getTime() + 60 * 60 * 1000),
        allDay: true,
        summary: `[마감] ${t.title} (${t.taskNumber})`,
        description: `상태: ${t.status}`,
        reminderMinutes: sub.reminderMinutes,
      });
    }
  }

  const ics = cal.toString();
  const etag = crypto
    .createHash('md5')
    .update(ics)
    .digest('hex');

  return { ics, etag };
}

/** 구독의 캐시된 etag 업데이트 */
export async function saveSubscriptionEtag(id: string, etag: string): Promise<void> {
  await prisma.calendarSubscription
    .update({ where: { id }, data: { lastEtag: etag } })
    .catch(() => { /* ignore */ });
}

// ── 내부 헬퍼 ──

function sanitizeReminders(arr: number[]): number[] {
  return Array.from(new Set(arr.filter((n) => Number.isFinite(n) && n >= 0 && n <= 24 * 60))).slice(0, 5);
}

function vacationTypeLabel(type: string): string {
  const map: Record<string, string> = {
    annual: '연차',
    half_am: '오전 반차',
    half_pm: '오후 반차',
    sick: '병가',
    special: '경조사',
    compensatory: '대체휴가',
  };
  return map[type] ?? type;
}

interface IcsEventInput {
  uid: string;
  start: Date;
  end: Date;
  allDay: boolean;
  summary: string;
  description?: string;
  location?: string;
  reminderMinutes: number[];
}

function addEventToCalendar(cal: ICalCalendar, input: IcsEventInput): void {
  const event = cal.createEvent({
    id: input.uid,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    summary: input.summary,
    description: input.description,
    location: input.location,
    busystatus: ICalEventBusyStatus.BUSY,
  });

  for (const minutes of input.reminderMinutes) {
    event.createAlarm({
      type: ICalAlarmType.display,
      trigger: minutes * 60, // ical-generator는 초 단위 (양수=이전)
      description: input.summary,
    });
  }
}
