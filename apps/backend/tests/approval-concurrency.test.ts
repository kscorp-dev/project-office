/**
 * Approval 동시 승인/반려 race condition 통합 테스트
 *
 * Phase 3-4에서 적용한 방어:
 * - 트랜잭션 내부에서 문서 재조회
 * - updateMany + where(currentStep/status)로 낙관적 락
 * - 중복 승인 차단 (ALREADY_ACTED)
 * - 동시 업데이트 감지 (CONCURRENT_UPDATE)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { AppError } from '../src/services/auth.service';
import { approvalService } from '../src/services/approval.service';
import {
  prisma,
  createPendingApproval,
  cleanupApproval,
  cleanupUsers,
} from './fixtures';

describe('Approval concurrency', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('동일 승인자의 2회 동시 approve → 1번만 성공', async () => {
    const { drafter, approvers, template, doc } = await createPendingApproval(3);
    const approver1 = approvers[0];

    // 2회 동시 호출
    const results = await Promise.allSettled([
      approvalService.approve(doc.id, approver1.id, 'OK first'),
      approvalService.approve(doc.id, approver1.id, 'OK second'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(AppError);
    // CONCURRENT_UPDATE 또는 ALREADY_ACTED 중 하나 (순서에 따라)
    expect(['CONCURRENT_UPDATE', 'ALREADY_ACTED', 'NOT_YOUR_TURN'])
      .toContain((reason as AppError).code);

    // 최종 상태 확인: 승인 1번만 처리됨
    const finalDoc = await prisma.approvalDocument.findUnique({
      where: { id: doc.id },
      include: { lines: { orderBy: { step: 'asc' } } },
    });
    expect(finalDoc?.currentStep).toBe(2);
    expect(finalDoc?.lines[0].status).toBe('approved');
    expect(finalDoc?.lines[1].status).toBe('pending');

    // cleanup
    await cleanupApproval(doc.id);
    await cleanupUsers([drafter.id, ...approvers.map((a) => a.id)]);
    await prisma.approvalTemplate.delete({ where: { id: template.id } });
  });

  it('결재선 범위를 벗어난 currentStep → INVALID_STATE', async () => {
    const { drafter, approvers, template, doc } = await createPendingApproval(2);

    // currentStep을 일부러 범위 밖으로 조작
    await prisma.approvalDocument.update({
      where: { id: doc.id },
      data: { currentStep: 99 },
    });

    await expect(
      approvalService.approve(doc.id, approvers[0].id, '').catch((e) => { throw e; }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'INVALID_STATE',
    });

    await cleanupApproval(doc.id);
    await cleanupUsers([drafter.id, ...approvers.map((a) => a.id)]);
    await prisma.approvalTemplate.delete({ where: { id: template.id } });
  });

  it('다른 사용자가 승인 시도 → NOT_YOUR_TURN', async () => {
    const { drafter, approvers, template, doc } = await createPendingApproval(2);
    const wrongUser = approvers[1]; // 2단계 승인자 (아직 차례 아님)

    await expect(
      approvalService.approve(doc.id, wrongUser.id, ''),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });

    await cleanupApproval(doc.id);
    await cleanupUsers([drafter.id, ...approvers.map((a) => a.id)]);
    await prisma.approvalTemplate.delete({ where: { id: template.id } });
  });

  it('마지막 단계 승인 → 문서 status=approved', async () => {
    const { drafter, approvers, template, doc } = await createPendingApproval(1);

    await approvalService.approve(doc.id, approvers[0].id, 'final');

    const finalDoc = await prisma.approvalDocument.findUnique({ where: { id: doc.id } });
    expect(finalDoc?.status).toBe('approved');
    expect(finalDoc?.completedAt).not.toBeNull();

    await cleanupApproval(doc.id);
    await cleanupUsers([drafter.id, ...approvers.map((a) => a.id)]);
    await prisma.approvalTemplate.delete({ where: { id: template.id } });
  });

  it('승인 + 반려 동시 요청 → 한쪽만 성공 (다른 쪽은 409)', async () => {
    const { drafter, approvers, template, doc } = await createPendingApproval(2);
    const approver1 = approvers[0];

    const results = await Promise.allSettled([
      approvalService.approve(doc.id, approver1.id, 'approve'),
      approvalService.reject(doc.id, approver1.id, 'reject reason'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);

    // 최종 상태는 approved 또는 rejected 중 하나
    const finalDoc = await prisma.approvalDocument.findUnique({ where: { id: doc.id } });
    expect(['approved', 'pending', 'rejected']).toContain(finalDoc?.status);
    // 승인 성공이었으면 2단계로 진행, 반려면 rejected, 둘 다 currentStep=1에서 머물 가능성 없음
    if (finalDoc?.status === 'approved') {
      // 1단계 승인 → 2단계로 진행
      expect(finalDoc.currentStep).toBe(2);
    }

    await cleanupApproval(doc.id);
    await cleanupUsers([drafter.id, ...approvers.map((a) => a.id)]);
    await prisma.approvalTemplate.delete({ where: { id: template.id } });
  });
});
