/**
 * 휴가 ↔ 전자결재 ↔ 캘린더 통합 서비스
 *
 * 기획 명세 §12 "비즈니스 규칙"의 필수 흐름:
 *
 *   [사용자가 휴가 신청]
 *       ↓
 *   attendance.routes POST /vacations
 *       ↓
 *   createVacationWithApproval()  ← 이 서비스
 *       ├─ Vacation(status=pending) 생성
 *       ├─ ApprovalDocument(template.code='vacation', status=pending) 생성
 *       ├─ 결재선 생성 (approverIds)
 *       └─ Vacation.approvalDocId ↔ ApprovalDocument.id 양방향 링크
 *       ↓
 *   결재선의 결재자들이 순차 승인
 *       ↓
 *   approval.service.approve — 최종 결재자 승인 시
 *       ↓
 *   applyVacationOnFinalApproval()  ← 이 서비스 (onFinalApproved 콜백)
 *       ├─ Vacation.status = 'approved', approvedAt, approvedBy
 *       ├─ VacationBalance 차감 (annual/half 종류만)
 *       ├─ CalendarEvent 생성 (type='vacation', 기안자의 일정)
 *       └─ 기안자에게 '휴가 승인됨' 알림
 *
 *   반려 시:
 *       applyVacationOnRejection() — Vacation.status = 'rejected', rejectionReason
 *       + 기안자에게 '휴가 반려됨' 알림
 */
import { Prisma, type VacationType, type ApprovalDocument } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from './auth.service';

export interface CreateVacationWithApprovalInput {
  userId: string;
  type: VacationType;
  startDate: Date;
  endDate: Date;
  days: number;
  reason?: string;
  approverIds: string[];
  referenceIds?: string[];
  templateId?: string; // 없으면 code='vacation' 자동 조회
}

/** 휴가 양식 템플릿 ID 조회 (없으면 에러) */
async function findVacationTemplate(
  tx: Prisma.TransactionClient,
  templateId?: string,
): Promise<{ id: string; code: string }> {
  if (templateId) {
    const t = await tx.approvalTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, code: true, isActive: true },
    });
    if (!t || !t.isActive) {
      throw new AppError(400, 'INVALID_TEMPLATE', '유효하지 않은 결재 양식입니다');
    }
    return { id: t.id, code: t.code };
  }
  // seed는 'VACATION'으로 등록되므로 대소문자 무시 검색
  const t = await tx.approvalTemplate.findFirst({
    where: { code: { equals: 'VACATION', mode: 'insensitive' }, isActive: true },
    select: { id: true, code: true },
  });
  if (!t) {
    throw new AppError(
      500,
      'NO_VACATION_TEMPLATE',
      '휴가 신청서 양식(code=VACATION)이 시스템에 등록되어 있지 않습니다',
    );
  }
  return t;
}

/**
 * 문서번호 채번 — advisory lock으로 동시성 직렬화
 * 같은 (연도, 템플릿) prefix에 대해 동시에 여러 트랜잭션이 진입해도 순차 처리.
 * pg_advisory_xact_lock은 트랜잭션 COMMIT/ROLLBACK 시 자동 해제.
 */
async function generateDocNumber(
  tx: Prisma.TransactionClient,
  templateCode: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${templateCode}-${year}-`;

  // 같은 prefix에 대한 트랜잭션 단위 직렬화 (void 반환이라 executeRaw 사용)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;

  const last = await tx.approvalDocument.findFirst({
    where: { docNumber: { startsWith: prefix } },
    orderBy: { docNumber: 'desc' },
  });
  let seq = 1;
  if (last) {
    const lastSeq = parseInt(last.docNumber.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/**
 * 휴가 신청 + 결재 문서 + 결재선을 단일 트랜잭션으로 생성
 * 연차 유형일 경우 잔여일수 선행 검증
 */
export async function createVacationWithApproval(
  input: CreateVacationWithApprovalInput,
): Promise<{ vacationId: string; approvalDocId: string; docNumber: string }> {
  if (input.approverIds.length === 0) {
    throw new AppError(400, 'NO_APPROVER', '결재선을 지정해주세요');
  }
  if (input.endDate < input.startDate) {
    throw new AppError(400, 'INVALID_RANGE', '종료일은 시작일 이후여야 합니다');
  }

  // 연차 유형이면 잔여일수 검증 (트랜잭션 밖에서 빠른 실패)
  const year = input.startDate.getFullYear();
  const isConsumingAnnual =
    input.type === 'annual' || input.type === 'half_am' || input.type === 'half_pm';
  if (isConsumingAnnual) {
    const balance = await prisma.vacationBalance.findUnique({
      where: { userId_year: { userId: input.userId, year } },
    });
    if (balance && balance.remainDays < input.days) {
      throw new AppError(
        400,
        'INSUFFICIENT_BALANCE',
        `잔여 연차가 부족합니다 (${balance.remainDays}일 남음)`,
      );
    }
  }

  // Unique 위반 시 최대 5회까지 재시도 (advisory lock이 있어도 테스트 병렬/DB 상태 변동 대비)
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tryCreate();
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 10 + attempt * 30));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;

  async function tryCreate() {
    return prisma.$transaction(async (tx) => {
      const template = await findVacationTemplate(tx, input.templateId);
      const docNumber = await generateDocNumber(tx, template.code);

    // Vacation 먼저 생성 (approvalDocId는 뒤에 update)
    const vacation = await tx.vacation.create({
      data: {
        userId: input.userId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days,
        reason: input.reason,
        status: 'pending',
      },
    });

    // 드래프터(신청자) 이름으로 문서 제목 생성
    const drafter = await tx.user.findUnique({
      where: { id: input.userId },
      select: { name: true },
    });
    const title = `[휴가 신청] ${drafter?.name || '사용자'} — ${toDateStr(input.startDate)} ~ ${toDateStr(input.endDate)} (${input.days}일)`;

    // 결재 문서
    const doc = await tx.approvalDocument.create({
      data: {
        docNumber,
        templateId: template.id,
        title,
        content: buildVacationContent(input, drafter?.name),
        formData: {
          vacationId: vacation.id,
          type: input.type,
          startDate: input.startDate.toISOString(),
          endDate: input.endDate.toISOString(),
          days: input.days,
          reason: input.reason ?? null,
        } as Prisma.InputJsonValue,
        urgency: 'normal',
        drafterId: input.userId,
        status: 'pending',
        currentStep: 1,
        submittedAt: new Date(),
      },
    });

    // 결재선
    await tx.approvalLine.createMany({
      data: input.approverIds.map((approverId, index) => ({
        documentId: doc.id,
        approverId,
        step: index + 1,
        type: 'serial',
        status: 'pending',
      })),
    });

    // 참조자
    if (input.referenceIds && input.referenceIds.length > 0) {
      await tx.approvalReference.createMany({
        data: input.referenceIds.map((userId) => ({
          documentId: doc.id,
          userId,
        })),
      });
    }

    // Vacation ↔ Approval 양방향 링크
    await tx.vacation.update({
      where: { id: vacation.id },
      data: { approvalDocId: doc.id },
    });

      return { vacationId: vacation.id, approvalDocId: doc.id, docNumber };
    });
  }
}

/**
 * 결재 문서가 최종 승인되었을 때 호출되는 콜백
 * (approval.service.approve 트랜잭션 내부에서 실행)
 *
 * 1) Vacation.status = approved
 * 2) VacationBalance 차감 (annual/half 종류)
 * 3) CalendarEvent 생성 (기안자 개인 일정)
 */
export async function applyVacationOnFinalApproval(
  tx: Prisma.TransactionClient,
  doc: ApprovalDocument,
  finalApproverId: string,
): Promise<void> {
  const formData = (doc.formData as Record<string, unknown> | null) ?? {};
  const vacationId = typeof formData.vacationId === 'string' ? formData.vacationId : null;
  if (!vacationId) return; // 휴가 아님

  const vacation = await tx.vacation.findUnique({ where: { id: vacationId } });
  if (!vacation) return;

  // 이미 처리된 휴가는 skip
  if (vacation.status !== 'pending') return;

  // 1. Vacation 승인 상태로
  const updatedVacation = await tx.vacation.update({
    where: { id: vacationId },
    data: {
      status: 'approved',
      approvedBy: finalApproverId,
      approvedAt: new Date(),
    },
  });

  // 2. 연차 차감 (annual, half_am, half_pm만)
  const isConsumingAnnual =
    updatedVacation.type === 'annual' ||
    updatedVacation.type === 'half_am' ||
    updatedVacation.type === 'half_pm';
  if (isConsumingAnnual) {
    const year = updatedVacation.startDate.getFullYear();
    await tx.vacationBalance.upsert({
      where: { userId_year: { userId: updatedVacation.userId, year } },
      update: {
        usedDays: { increment: updatedVacation.days },
        remainDays: { decrement: updatedVacation.days },
      },
      create: {
        userId: updatedVacation.userId,
        year,
        totalDays: 15,
        usedDays: updatedVacation.days,
        remainDays: 15 - updatedVacation.days,
      },
    });
  }

  // 3. 캘린더 자동 등록 (개인 일정)
  // CalendarEvent에 ref 필드가 없어 description에 vacation ID 태그를 심어 추후 연결
  await tx.calendarEvent.create({
    data: {
      title: `휴가 (${vacationTypeLabel(updatedVacation.type)})`,
      description: `[vacation:${updatedVacation.id}]\n${updatedVacation.reason || ''}`.trim(),
      startDate: updatedVacation.startDate,
      endDate: updatedVacation.endDate,
      allDay: true,
      color: '#facc15',
      scope: 'personal',
      creatorId: updatedVacation.userId,
    },
  });
}

/**
 * 결재 문서가 반려되었을 때 호출되는 콜백
 * Vacation.status = rejected + rejectionReason
 */
export async function applyVacationOnRejection(
  tx: Prisma.TransactionClient,
  doc: ApprovalDocument,
  rejectionReason: string,
): Promise<void> {
  const formData = (doc.formData as Record<string, unknown> | null) ?? {};
  const vacationId = typeof formData.vacationId === 'string' ? formData.vacationId : null;
  if (!vacationId) return;

  const vacation = await tx.vacation.findUnique({ where: { id: vacationId } });
  if (!vacation || vacation.status !== 'pending') return;

  await tx.vacation.update({
    where: { id: vacationId },
    data: {
      status: 'rejected',
      rejectionReason,
    },
  });
}

// ── 헬퍼 ──

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function vacationTypeLabel(type: VacationType): string {
  const map: Record<VacationType, string> = {
    annual: '연차',
    half_am: '오전 반차',
    half_pm: '오후 반차',
    sick: '병가',
    special: '경조사',
    compensatory: '대체휴가',
  };
  return map[type] ?? type;
}

function buildVacationContent(input: CreateVacationWithApprovalInput, drafterName?: string): string {
  return `
<h3>휴가 신청</h3>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
  <tr><th>신청자</th><td>${escapeHtml(drafterName || '')}</td></tr>
  <tr><th>휴가 유형</th><td>${vacationTypeLabel(input.type)}</td></tr>
  <tr><th>기간</th><td>${toDateStr(input.startDate)} ~ ${toDateStr(input.endDate)}</td></tr>
  <tr><th>일수</th><td>${input.days}일</td></tr>
  <tr><th>사유</th><td>${escapeHtml(input.reason ?? '')}</td></tr>
</table>
`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
}
