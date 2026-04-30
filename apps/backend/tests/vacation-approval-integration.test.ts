/**
 * 휴가 ↔ 전자결재 ↔ 연차 차감 ↔ 캘린더 통합 E2E 테스트
 *
 * 기획 §12 비즈니스 규칙 검증:
 *   1. 휴가 신청 → Vacation(pending) + ApprovalDocument(pending) 동시 생성
 *   2. 양방향 링크 (Vacation.approvalDocId ↔ ApprovalDocument.id)
 *   3. 최종 결재 승인 → Vacation.status=approved + VacationBalance 차감 + CalendarEvent 자동등록
 *   4. 반려 → Vacation.status=rejected
 *   5. 잔여 연차 부족 시 신청 거부
 *
 * Claude API / Anthropic SDK 호출 없음 — 순수 DB/로직 검증.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import prisma from '../src/config/prisma';
import {
  createVacationWithApproval,
} from '../src/services/vacation-approval.service';
import { approvalService } from '../src/services/approval.service';
import { createTestUser, uniqueId } from './fixtures';

let drafter: Awaited<ReturnType<typeof createTestUser>>;
let approver1: Awaited<ReturnType<typeof createTestUser>>;
let approver2: Awaited<ReturnType<typeof createTestUser>>;

const createdDocIds: string[] = [];
const createdVacationIds: string[] = [];

// 휴가 양식 — 테스트 시작 전 보장
let vacationTemplateId: string;

beforeAll(async () => {
  drafter = await createTestUser({ role: 'user' as any });
  approver1 = await createTestUser({ role: 'user' as any });
  approver2 = await createTestUser({ role: 'user' as any });

  // VACATION 템플릿 보장 (seed가 돌았으면 이미 있음)
  const existing = await prisma.approvalTemplate.findFirst({
    where: { code: { equals: 'VACATION', mode: 'insensitive' } },
  });
  if (existing) {
    vacationTemplateId = existing.id;
  } else {
    const created = await prisma.approvalTemplate.create({
      data: { name: '휴가 신청서', code: 'VACATION', category: '휴가', sortOrder: 100 },
    });
    vacationTemplateId = created.id;
  }

  // 이전 실행의 VACATION-YYYY-* 찌꺼기 청소 (test scope 한정)
  const year = new Date().getFullYear();
  const orphanDocs = await prisma.approvalDocument.findMany({
    where: { docNumber: { startsWith: `VACATION-${year}-` } },
    select: { id: true },
  });
  if (orphanDocs.length) {
    const ids = orphanDocs.map((d) => d.id);
    await prisma.vacation.updateMany({
      where: { approvalDocId: { in: ids } },
      data: { approvalDocId: null },
    });
    await prisma.approvalAttachment.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.approvalReference.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.approvalLine.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.approvalDocument.deleteMany({ where: { id: { in: ids } } });
  }

  // drafter 연차 잔여 초기화 (중복 실행 대비 — 각 테스트는 이 값 기반)
  await prisma.vacationBalance.upsert({
    where: { userId_year: { userId: drafter.id, year } },
    update: { totalDays: 15, usedDays: 0, remainDays: 15 },
    create: { userId: drafter.id, year, totalDays: 15, usedDays: 0, remainDays: 15 },
  });
});

afterAll(async () => {
  await prisma.calendarEvent.deleteMany({ where: { creatorId: drafter.id } });
  await prisma.vacationBalance.deleteMany({ where: { userId: drafter.id } });
  await prisma.vacation.deleteMany({ where: { id: { in: createdVacationIds } } });
  await prisma.approvalAttachment.deleteMany({ where: { documentId: { in: createdDocIds } } });
  await prisma.approvalReference.deleteMany({ where: { documentId: { in: createdDocIds } } });
  await prisma.approvalLine.deleteMany({ where: { documentId: { in: createdDocIds } } });
  await prisma.approvalDocument.deleteMany({ where: { id: { in: createdDocIds } } });
  await prisma.notification.deleteMany({
    where: { recipientId: { in: [drafter.id, approver1.id, approver2.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [drafter.id, approver1.id, approver2.id] } } });
  await prisma.$disconnect();
});

describe('Vacation ↔ Approval 통합', () => {
  it('휴가 신청 시 Vacation + ApprovalDocument가 함께 생성되고 양방향 연결', async () => {
    const result = await createVacationWithApproval({
      userId: drafter.id,
      type: 'annual',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-01T00:00:00Z'),
      days: 1,
      reason: '개인 일정',
      approverIds: [approver1.id, approver2.id],
    });
    createdDocIds.push(result.approvalDocId);
    createdVacationIds.push(result.vacationId);

    const vacation = await prisma.vacation.findUnique({ where: { id: result.vacationId } });
    const doc = await prisma.approvalDocument.findUnique({
      where: { id: result.approvalDocId },
      include: { lines: { orderBy: { step: 'asc' } }, template: true },
    });

    expect(vacation).not.toBeNull();
    expect(vacation?.status).toBe('pending');
    expect(vacation?.approvalDocId).toBe(result.approvalDocId);

    expect(doc).not.toBeNull();
    expect(doc?.status).toBe('pending');
    expect(doc?.currentStep).toBe(1);
    expect(doc?.template.code.toUpperCase()).toBe('VACATION');
    expect(doc?.lines).toHaveLength(2);
    expect(doc?.lines[0].approverId).toBe(approver1.id);
    expect(doc?.lines[1].approverId).toBe(approver2.id);

    // formData에 vacationId 저장
    const formData = doc?.formData as Record<string, unknown>;
    expect(formData?.vacationId).toBe(result.vacationId);
  });

  it('결재선 2명이 순차 승인 → 휴가 approved + 연차 1일 차감 + CalendarEvent 생성', async () => {
    const result = await createVacationWithApproval({
      userId: drafter.id,
      type: 'annual',
      startDate: new Date('2026-07-01T00:00:00Z'),
      endDate: new Date('2026-07-02T00:00:00Z'),
      days: 2,
      reason: '여름 휴가',
      approverIds: [approver1.id, approver2.id],
    });
    createdDocIds.push(result.approvalDocId);
    createdVacationIds.push(result.vacationId);

    // 1단계 결재자 승인
    await approvalService.approve(result.approvalDocId, approver1.id, '확인');
    const midDoc = await prisma.approvalDocument.findUnique({
      where: { id: result.approvalDocId },
    });
    expect(midDoc?.status).toBe('pending');
    expect(midDoc?.currentStep).toBe(2);

    // 아직 휴가는 pending
    const midVac = await prisma.vacation.findUnique({ where: { id: result.vacationId } });
    expect(midVac?.status).toBe('pending');

    // 잔여일수 변화 없음
    const year = new Date().getFullYear();
    const midBalance = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: drafter.id, year } },
    });
    const initialRemain = midBalance?.remainDays ?? 0;

    // 2단계(최종) 결재자 승인
    await approvalService.approve(result.approvalDocId, approver2.id, '승인');

    // 검증
    const finalDoc = await prisma.approvalDocument.findUnique({
      where: { id: result.approvalDocId },
    });
    const finalVac = await prisma.vacation.findUnique({ where: { id: result.vacationId } });
    const finalBalance = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: drafter.id, year } },
    });
    const calendarEvents = await prisma.calendarEvent.findMany({
      where: {
        creatorId: drafter.id,
        description: { contains: `[vacation:${result.vacationId}]` },
      },
    });

    expect(finalDoc?.status).toBe('approved');
    expect(finalDoc?.completedAt).not.toBeNull();
    expect(finalVac?.status).toBe('approved');
    expect(finalVac?.approvedBy).toBe(approver2.id);
    expect(finalBalance?.remainDays).toBe(initialRemain - 2);
    expect(finalBalance?.usedDays).toBeGreaterThanOrEqual(2);
    expect(calendarEvents).toHaveLength(1);
    expect(calendarEvents[0].allDay).toBe(true);
    expect(calendarEvents[0].scope).toBe('personal');
  });

  it('반려 시 Vacation.status=rejected + 연차 차감/캘린더 등록 없음', async () => {
    const year = new Date().getFullYear();
    const before = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: drafter.id, year } },
    });
    const calBefore = await prisma.calendarEvent.count({ where: { creatorId: drafter.id } });

    const result = await createVacationWithApproval({
      userId: drafter.id,
      type: 'annual',
      startDate: new Date('2026-08-15T00:00:00Z'),
      endDate: new Date('2026-08-15T00:00:00Z'),
      days: 1,
      reason: '기각될 예정',
      approverIds: [approver1.id],
    });
    createdDocIds.push(result.approvalDocId);
    createdVacationIds.push(result.vacationId);

    await approvalService.reject(result.approvalDocId, approver1.id, '사유 불충분');

    const vac = await prisma.vacation.findUnique({ where: { id: result.vacationId } });
    const doc = await prisma.approvalDocument.findUnique({ where: { id: result.approvalDocId } });
    const after = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: drafter.id, year } },
    });
    const calAfter = await prisma.calendarEvent.count({ where: { creatorId: drafter.id } });

    expect(doc?.status).toBe('rejected');
    expect(vac?.status).toBe('rejected');
    expect(vac?.rejectionReason).toBe('사유 불충분');
    expect(after?.remainDays).toBe(before?.remainDays);
    expect(calAfter).toBe(calBefore); // 새 캘린더 이벤트 없음
  });

  it('잔여 연차 부족 시 신청 거부 (INSUFFICIENT_BALANCE)', async () => {
    // 잔여 연차 부족 — drafter 의 잔여를 0으로 set 후 1일 신청
    await prisma.vacationBalance.upsert({
      where: { userId_year: { userId: drafter.id, year: 2026 } },
      update: { totalDays: 5, usedDays: 5, remainDays: 0 },
      create: { userId: drafter.id, year: 2026, totalDays: 5, usedDays: 5, remainDays: 0 },
    });
    await expect(
      createVacationWithApproval({
        userId: drafter.id,
        type: 'annual',
        startDate: new Date('2026-12-20T00:00:00Z'),
        endDate: new Date('2026-12-20T00:00:00Z'),
        days: 1,
        reason: '연말휴가',
        approverIds: [approver1.id],
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('days 가 31일 초과 → INVALID_DAYS', async () => {
    await expect(
      createVacationWithApproval({
        userId: drafter.id,
        type: 'annual',
        startDate: new Date('2026-12-01T00:00:00Z'),
        endDate: new Date('2027-02-01T00:00:00Z'),
        days: 60,
        reason: '장기휴가',
        approverIds: [approver1.id],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DAYS' });
  });

  it('days 가 calendar 일수보다 큼 → DAYS_MISMATCH', async () => {
    await expect(
      createVacationWithApproval({
        userId: drafter.id,
        type: 'annual',
        startDate: new Date('2026-12-01T00:00:00Z'),
        endDate: new Date('2026-12-01T00:00:00Z'), // 1일 기간
        days: 5, // 5일 사용 시도
        reason: '부정 시도',
        approverIds: [approver1.id],
      }),
    ).rejects.toMatchObject({ code: 'DAYS_MISMATCH' });
  });

  it('결재선 없으면 NO_APPROVER', async () => {
    await expect(
      createVacationWithApproval({
        userId: drafter.id,
        type: 'sick',
        startDate: new Date('2026-05-01T00:00:00Z'),
        endDate: new Date('2026-05-01T00:00:00Z'),
        days: 1,
        approverIds: [], // 빈 배열
      }),
    ).rejects.toMatchObject({ code: 'NO_APPROVER' });
  });

  it('sick/special 유형은 연차 차감 안함', async () => {
    const year = new Date().getFullYear();
    const before = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: drafter.id, year } },
    });

    const result = await createVacationWithApproval({
      userId: drafter.id,
      type: 'sick',
      startDate: new Date('2026-09-10T00:00:00Z'),
      endDate: new Date('2026-09-10T00:00:00Z'),
      days: 1,
      approverIds: [approver1.id],
    });
    createdDocIds.push(result.approvalDocId);
    createdVacationIds.push(result.vacationId);

    await approvalService.approve(result.approvalDocId, approver1.id);

    const vac = await prisma.vacation.findUnique({ where: { id: result.vacationId } });
    const after = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: drafter.id, year } },
    });
    expect(vac?.status).toBe('approved');
    expect(after?.remainDays).toBe(before?.remainDays); // 차감 없음
  });
});

describe('알림 훅', () => {
  it('결재 승인 시 기안자에게 approval_approved 알림 발송', async () => {
    const result = await createVacationWithApproval({
      userId: drafter.id,
      type: 'sick',
      startDate: new Date('2026-10-05T00:00:00Z'),
      endDate: new Date('2026-10-05T00:00:00Z'),
      days: 1,
      approverIds: [approver1.id],
    });
    createdDocIds.push(result.approvalDocId);
    createdVacationIds.push(result.vacationId);

    await approvalService.approve(result.approvalDocId, approver1.id);

    const notifs = await prisma.notification.findMany({
      where: { recipientId: drafter.id, refId: result.approvalDocId },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs.some((n) => n.type === 'approval_approved')).toBe(true);
  });

  it('결재 반려 시 기안자에게 approval_rejected 알림 발송', async () => {
    const result = await createVacationWithApproval({
      userId: drafter.id,
      type: 'sick',
      startDate: new Date('2026-10-06T00:00:00Z'),
      endDate: new Date('2026-10-06T00:00:00Z'),
      days: 1,
      approverIds: [approver1.id],
    });
    createdDocIds.push(result.approvalDocId);
    createdVacationIds.push(result.vacationId);

    await approvalService.reject(result.approvalDocId, approver1.id, '거절');

    const notifs = await prisma.notification.findMany({
      where: { recipientId: drafter.id, refId: result.approvalDocId, type: 'approval_rejected' },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });
});
