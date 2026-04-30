/**
 * 결재 위임/대결 서비스
 *
 * 모델:
 *   - ApprovalDelegation { fromUserId, toUserId, startDate, endDate, isActive }
 *   - 활성 위임 = isActive=true AND now ∈ [startDate, endDate]
 *
 * 정책:
 *   - 한 사용자가 동시에 여러 사람에게 위임 가능 (예: A→B, A→C)
 *     → A 의 결재 도착 시 B, C 모두에게 알림 + 둘 다 처리 가능, 누구든 먼저 처리하면 line.actedByUserId 에 기록
 *   - 위임 받은 사람은 본인 라인 + 위임받은 라인 모두 처리 가능
 *   - 자기 자신에게 위임 불가 (fromUserId === toUserId 차단)
 *   - 결재 처리 시 권한 검증은 `canActOnLine()` 으로 단일화
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from './auth.service';

export interface CreateDelegationInput {
  fromUserId: string;
  toUserId: string;
  startDate: Date;
  endDate: Date;
  reason?: string;
}

/**
 * 위임 생성. fromUserId 본인이 호출해야 함 (라우트에서 검증).
 */
export async function createDelegation(input: CreateDelegationInput) {
  if (input.fromUserId === input.toUserId) {
    throw new AppError(400, 'INVALID_TARGET', '자기 자신에게는 위임할 수 없습니다');
  }
  if (input.endDate <= input.startDate) {
    throw new AppError(400, 'INVALID_RANGE', '종료일은 시작일보다 이후여야 합니다');
  }
  if (input.endDate < new Date()) {
    throw new AppError(400, 'PAST_RANGE', '이미 지난 기간으로는 위임을 만들 수 없습니다');
  }

  // 위임 받는 사람이 active 사용자인지 검증
  const target = await prisma.user.findUnique({
    where: { id: input.toUserId },
    select: { id: true, status: true },
  });
  if (!target) {
    throw new AppError(404, 'TARGET_NOT_FOUND', '위임 대상 사용자를 찾을 수 없습니다');
  }
  if (target.status !== 'active') {
    throw new AppError(400, 'TARGET_INACTIVE', '비활성 사용자에게는 위임할 수 없습니다');
  }

  // 동시 생성 race + cycle 검사 — 모두 트랜잭션 안에서 advisory lock 확보 후 검증
  //   lock 키를 페어 정렬 → A→B 와 B→A 가 같은 lock 을 잡아 race 방지 (audit 11차 H2)
  return prisma.$transaction(async (tx) => {
    const pair = [input.fromUserId, input.toUserId].sort().join(':');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pair}))`;

    // cycle (B→A) — 같은 lock 안에서 read 라 race 안전
    const reverseChain = await tx.approvalDelegation.findFirst({
      where: {
        fromUserId: input.toUserId,
        toUserId: input.fromUserId,
        isActive: true,
        startDate: { lte: input.endDate },
        endDate: { gte: input.startDate },
      },
    });
    if (reverseChain) {
      throw new AppError(409, 'CIRCULAR_DELEGATION',
        '상대가 본인에게 이미 위임을 만들었습니다 (위임 순환)');
    }

    // 같은 from→to 활성 위임에 시간 겹침이 있으면 차단
    const overlapping = await tx.approvalDelegation.findFirst({
      where: {
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        isActive: true,
        startDate: { lte: input.endDate },
        endDate: { gte: input.startDate },
      },
    });
    if (overlapping) {
      throw new AppError(409, 'DUPLICATE_DELEGATION',
        '이미 같은 대상에게 겹치는 기간의 활성 위임이 존재합니다');
    }

    return tx.approvalDelegation.create({
      data: {
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        isActive: true,
      },
      include: {
        toUser: { select: { id: true, name: true, position: true, employeeId: true, department: { select: { name: true } } } },
      },
    });
  });
}

/** 내가 만든 위임 목록 (가장 최근 먼저) */
export async function listMyDelegations(userId: string) {
  return prisma.approvalDelegation.findMany({
    where: { fromUserId: userId },
    orderBy: { createdAt: 'desc' },
    include: {
      toUser: { select: { id: true, name: true, position: true, employeeId: true, department: { select: { name: true } } } },
    },
  });
}

/** 내가 받은 위임 목록 (활성만) */
export async function listIncomingDelegations(userId: string) {
  const now = new Date();
  return prisma.approvalDelegation.findMany({
    where: {
      toUserId: userId,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      fromUser: { select: { id: true, name: true, position: true, employeeId: true, department: { select: { name: true } } } },
    },
  });
}

/** 위임 비활성화 (본인 또는 관리자만) */
export async function cancelDelegation(delegationId: string, userId: string, isAdmin: boolean): Promise<void> {
  const dlg = await prisma.approvalDelegation.findUnique({ where: { id: delegationId } });
  if (!dlg) throw new AppError(404, 'NOT_FOUND', '위임을 찾을 수 없습니다');
  if (!isAdmin && dlg.fromUserId !== userId) {
    throw new AppError(403, 'FORBIDDEN', '본인 위임만 취소할 수 있습니다');
  }
  await prisma.approvalDelegation.update({
    where: { id: delegationId },
    data: { isActive: false },
  });
}

/**
 * 특정 line 을 어떤 사용자가 처리할 수 있는지 검증.
 * - 본인이 line.approverId 면 항상 가능
 * - 위임 받은 사용자(toUserId === userId)고 위임 활성 + 시간 내면 가능
 *
 * @param tx 호출자가 트랜잭션 안에서 호출 시 tx 전달 — 위임 cancel 과의 race 방지
 *           (audit H4). 미전달 시 전역 prisma 사용.
 * @returns 처리 권한이 있으면 actor 정보, 없으면 null
 */
export async function canActOnLine(
  line: { approverId: string },
  actorUserId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ asOriginal: boolean; viaDelegation: boolean; delegationId: string | null }> {
  if (line.approverId === actorUserId) {
    return { asOriginal: true, viaDelegation: false, delegationId: null };
  }
  // 위임 검색 — 트랜잭션이 주어지면 그 안에서 일관된 read 보장
  const client = tx ?? prisma;
  const now = new Date();
  const dlg = await client.approvalDelegation.findFirst({
    where: {
      fromUserId: line.approverId,
      toUserId: actorUserId,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    select: { id: true },
  });
  if (!dlg) {
    return { asOriginal: false, viaDelegation: false, delegationId: null };
  }
  return { asOriginal: false, viaDelegation: true, delegationId: dlg.id };
}
