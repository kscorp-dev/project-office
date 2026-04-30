import prisma from '../config/prisma';
import { AppError } from './auth.service';
import {
  applyVacationOnFinalApproval,
  applyVacationOnRejection,
} from './vacation-approval.service';
import { createNotification } from './notification.service';
import { canActOnLine } from './delegation.service';

interface CreateDocumentData {
  templateId: string;
  title: string;
  content: string;
  formData?: Record<string, unknown>;
  urgency?: string;
  approverIds: string[];  // 결재선 (순서대로)
  referenceIds?: string[]; // 참조자
}

export class ApprovalService {
  /**
   * 문서번호 생성: {양식코드}-{연도}-{순번}
   */
  private async generateDocNumber(templateCode: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `${templateCode}-${year}-`;

    const last = await prisma.approvalDocument.findFirst({
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
   * 결재 문서 작성 (임시저장 또는 상신)
   */
  async createDocument(drafterId: string, data: CreateDocumentData, submit = false) {
    const template = await prisma.approvalTemplate.findUnique({ where: { id: data.templateId } });
    if (!template || !template.isActive) {
      throw new AppError(400, 'INVALID_TEMPLATE', '유효하지 않은 결재 양식입니다');
    }

    const docNumber = await this.generateDocNumber(template.code);

    const document = await prisma.$transaction(async (tx) => {
      const doc = await tx.approvalDocument.create({
        data: {
          docNumber,
          templateId: data.templateId,
          title: data.title,
          content: data.content,
          formData: (data.formData ?? undefined) as any,
          urgency: data.urgency || 'normal',
          drafterId,
          status: submit ? 'pending' : 'draft',
          currentStep: submit ? 1 : 0,
          submittedAt: submit ? new Date() : null,
        },
      });

      // 결재선 생성
      if (data.approverIds.length > 0) {
        await tx.approvalLine.createMany({
          data: data.approverIds.map((approverId, index) => ({
            documentId: doc.id,
            approverId,
            step: index + 1,
            type: 'serial',
            status: 'pending',
          })),
        });
      }

      // 참조자 등록
      if (data.referenceIds && data.referenceIds.length > 0) {
        await tx.approvalReference.createMany({
          data: data.referenceIds.map((userId) => ({
            documentId: doc.id,
            userId,
          })),
        });
      }

      return doc;
    });

    return this.getDocumentDetail(document.id);
  }

  /**
   * 문서 상세 조회
   *
   * @param documentId - 문서 ID
   * @param requesterId - 조회 요청자 (권한 검사용). 생략하면 검사 스킵 (내부 호출용).
   * @param requesterRole - 요청자 역할 (super_admin/admin은 모든 문서 조회 가능)
   *
   * 권한: 기안자, 결재자, 참조자, 또는 관리자만 조회 가능
   */
  async getDocumentDetail(
    documentId: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    const doc = await prisma.approvalDocument.findUnique({
      where: { id: documentId },
      include: {
        template: { select: { id: true, name: true, code: true, category: true } },
        drafter: { select: { id: true, name: true, employeeId: true, position: true, department: { select: { name: true } } } },
        lines: {
          include: {
            approver: { select: { id: true, name: true, employeeId: true, position: true, department: { select: { name: true } } } },
          },
          orderBy: { step: 'asc' },
        },
        references: {
          include: {
            user: { select: { id: true, name: true, employeeId: true } },
          },
        },
        attachments: true,
      },
    });

    if (!doc) throw new AppError(404, 'NOT_FOUND', '결재 문서를 찾을 수 없습니다');

    // 권한 검사 — requesterId가 주어진 경우에만
    if (requesterId) {
      const isAdmin = requesterRole === 'super_admin' || requesterRole === 'admin';
      const isDrafter = doc.drafterId === requesterId;
      const isApprover = doc.lines.some((l) => l.approverId === requesterId);
      const isReference = doc.references.some((r) => r.userId === requesterId);

      if (!isAdmin && !isDrafter && !isApprover && !isReference) {
        throw new AppError(403, 'FORBIDDEN', '이 문서를 조회할 권한이 없습니다');
      }
    }

    return doc;
  }

  /**
   * 임시저장 → 상신
   */
  async submitDocument(documentId: string, userId: string) {
    const doc = await prisma.approvalDocument.findUnique({
      where: { id: documentId },
      include: { lines: true },
    });

    if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
    if (doc.drafterId !== userId) throw new AppError(403, 'FORBIDDEN', '본인의 문서만 상신할 수 있습니다');
    if (doc.status !== 'draft') throw new AppError(400, 'INVALID_STATUS', '임시저장 상태의 문서만 상신할 수 있습니다');
    if (doc.lines.length === 0) throw new AppError(400, 'NO_APPROVER', '결재선을 설정해주세요');

    return prisma.approvalDocument.update({
      where: { id: documentId },
      data: { status: 'pending', currentStep: 1, submittedAt: new Date() },
    });
  }

  /**
   * 결재 승인
   *
   * 동시성 방어:
   * 1) 트랜잭션 내부에서 문서를 다시 읽어 최신 currentStep으로 판단
   * 2) 문서 업데이트는 updateMany + where(currentStep) 조건부 업데이트로
   *    낙관적 락 효과 → 동시에 두 요청이 들어와도 한 쪽만 성공
   * 3) currentStep이 lines 범위를 벗어난 경우 방어적으로 에러
   */
  async approve(documentId: string, approverId: string, comment?: string) {
    await prisma.$transaction(async (tx) => {
      // 트랜잭션 내부에서 최신 상태로 재조회
      const doc = await tx.approvalDocument.findUnique({
        where: { id: documentId },
        include: { lines: { orderBy: { step: 'asc' } } },
      });

      if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
      if (doc.status !== 'pending') throw new AppError(400, 'INVALID_STATUS', '결재 대기 상태가 아닙니다');

      // currentStep 범위 검증 (잘못된 데이터 방어)
      if (doc.currentStep < 1 || doc.currentStep > doc.lines.length) {
        throw new AppError(500, 'INVALID_STATE', '결재 단계 상태가 올바르지 않습니다');
      }

      const currentLine = doc.lines.find((l) => l.step === doc.currentStep && l.status === 'pending');
      if (!currentLine) {
        throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
      }
      // 본인 결재 또는 위임 받은 결재인지 확인
      const auth = await canActOnLine(currentLine, approverId);
      if (!auth.asOriginal && !auth.viaDelegation) {
        throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
      }

      const isLastStep = doc.currentStep >= doc.lines.length;
      // 위임 처리 시 코멘트 앞에 [대결] 표기 자동 추가 (감사 추적용)
      const finalComment = auth.viaDelegation
        ? `[대결] ${comment ?? ''}`.trim()
        : comment;

      // 현재 결재선 승인 (pending 상태일 때만 — 중복 승인 차단)
      // actedByUserId 기록 — 본인 직접 처리면 null, 위임이면 처리한 사용자
      const lineUpdate = await tx.approvalLine.updateMany({
        where: { id: currentLine.id, status: 'pending' },
        data: {
          status: 'approved',
          comment: finalComment || null,
          actedAt: new Date(),
          actedByUserId: auth.viaDelegation ? approverId : null,
        },
      });
      if (lineUpdate.count === 0) {
        throw new AppError(409, 'ALREADY_ACTED', '이미 처리된 결재입니다');
      }

      // 문서 업데이트 — currentStep이 여전히 기대값일 때만 (낙관적 락)
      if (isLastStep) {
        const docUpdate = await tx.approvalDocument.updateMany({
          where: { id: documentId, currentStep: doc.currentStep, status: 'pending' },
          data: { status: 'approved', completedAt: new Date() },
        });
        if (docUpdate.count === 0) {
          throw new AppError(409, 'CONCURRENT_UPDATE', '다른 요청에 의해 상태가 변경되었습니다');
        }
        // 최종 승인 후처리 — 양식 코드별 분기 (휴가 등)
        const fullDoc = await tx.approvalDocument.findUnique({
          where: { id: documentId },
          include: { template: { select: { code: true } } },
        });
        if (fullDoc && fullDoc.template.code.toUpperCase() === 'VACATION') {
          // 휴가 후처리에는 원래 결재자(approverId) 기준 사용 — 위임이어도 라인의 approver 가 acting
          await applyVacationOnFinalApproval(tx, fullDoc, currentLine.approverId);
        }
      } else {
        const docUpdate = await tx.approvalDocument.updateMany({
          where: { id: documentId, currentStep: doc.currentStep, status: 'pending' },
          data: { currentStep: doc.currentStep + 1 },
        });
        if (docUpdate.count === 0) {
          throw new AppError(409, 'CONCURRENT_UPDATE', '다른 요청에 의해 상태가 변경되었습니다');
        }
      }
    });

    // 알림 (트랜잭션 외부, 실패해도 DB에 영향 없음)
    await this.notifyApprovalProgress(documentId, approverId, 'approved', comment).catch(() => {});

    return this.getDocumentDetail(documentId);
  }

  /**
   * 결재 반려 — approve와 동일한 동시성 방어 적용
   */
  async reject(documentId: string, approverId: string, comment: string) {
    if (!comment) throw new AppError(400, 'COMMENT_REQUIRED', '반려 사유를 입력해주세요');

    await prisma.$transaction(async (tx) => {
      const doc = await tx.approvalDocument.findUnique({
        where: { id: documentId },
        include: { lines: { orderBy: { step: 'asc' } } },
      });

      if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
      if (doc.status !== 'pending') throw new AppError(400, 'INVALID_STATUS', '결재 대기 상태가 아닙니다');

      if (doc.currentStep < 1 || doc.currentStep > doc.lines.length) {
        throw new AppError(500, 'INVALID_STATE', '결재 단계 상태가 올바르지 않습니다');
      }

      const currentLine = doc.lines.find((l) => l.step === doc.currentStep && l.status === 'pending');
      if (!currentLine) {
        throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
      }
      const auth = await canActOnLine(currentLine, approverId);
      if (!auth.asOriginal && !auth.viaDelegation) {
        throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
      }
      const finalComment = auth.viaDelegation ? `[대결] ${comment}` : comment;

      const lineUpdate = await tx.approvalLine.updateMany({
        where: { id: currentLine.id, status: 'pending' },
        data: {
          status: 'rejected',
          comment: finalComment,
          actedAt: new Date(),
          actedByUserId: auth.viaDelegation ? approverId : null,
        },
      });
      if (lineUpdate.count === 0) {
        throw new AppError(409, 'ALREADY_ACTED', '이미 처리된 결재입니다');
      }

      const docUpdate = await tx.approvalDocument.updateMany({
        where: { id: documentId, currentStep: doc.currentStep, status: 'pending' },
        data: { status: 'rejected', completedAt: new Date() },
      });
      if (docUpdate.count === 0) {
        throw new AppError(409, 'CONCURRENT_UPDATE', '다른 요청에 의해 상태가 변경되었습니다');
      }

      // 반려 후처리 — 양식 코드별 분기
      const fullDoc = await tx.approvalDocument.findUnique({
        where: { id: documentId },
        include: { template: { select: { code: true } } },
      });
      if (fullDoc && fullDoc.template.code.toUpperCase() === 'VACATION') {
        await applyVacationOnRejection(tx, fullDoc, comment);
      }
    });

    // 알림
    await this.notifyApprovalProgress(documentId, approverId, 'rejected', comment).catch(() => {});

    return this.getDocumentDetail(documentId);
  }

  /**
   * 결재 진행 상태 변경 시 알림 발송
   * - 최종 승인/반려: 기안자에게 결과 알림
   * - 중간 승인: 다음 결재자에게 "결재 요청" 알림
   * - 공통: 참조자에게 진행 상태 알림 (승인/반려 시만)
   */
  private async notifyApprovalProgress(
    documentId: string,
    actorId: string,
    kind: 'approved' | 'rejected',
    comment?: string,
  ): Promise<void> {
    const doc = await prisma.approvalDocument.findUnique({
      where: { id: documentId },
      include: {
        drafter: { select: { id: true, name: true } },
        lines: {
          include: { approver: { select: { id: true, name: true } } },
          orderBy: { step: 'asc' },
        },
        references: { select: { userId: true } },
      },
    });
    if (!doc) return;

    const link = `/approval/documents/${doc.id}`;
    const baseBody = `[${doc.docNumber}] ${doc.title}`;

    if (doc.status === 'rejected') {
      // 기안자에게 반려 알림
      await createNotification({
        recipientId: doc.drafterId,
        actorId,
        type: 'approval_rejected',
        title: '결재가 반려되었습니다',
        body: comment ? `${baseBody}\n반려사유: ${comment}` : baseBody,
        link,
        refType: 'approval',
        refId: doc.id,
      });
      // 참조자에게도 공유
      for (const ref of doc.references) {
        await createNotification({
          recipientId: ref.userId,
          actorId,
          type: 'approval_reference',
          title: '참조 문서가 반려되었습니다',
          body: baseBody,
          link,
          refType: 'approval',
          refId: doc.id,
        });
      }
      return;
    }

    if (doc.status === 'approved') {
      // 기안자에게 완료 알림
      await createNotification({
        recipientId: doc.drafterId,
        actorId,
        type: 'approval_approved',
        title: '결재가 최종 승인되었습니다',
        body: baseBody,
        link,
        refType: 'approval',
        refId: doc.id,
      });
      // 참조자에게 공유
      for (const ref of doc.references) {
        await createNotification({
          recipientId: ref.userId,
          actorId,
          type: 'approval_reference',
          title: '참조 문서가 완료되었습니다',
          body: baseBody,
          link,
          refType: 'approval',
          refId: doc.id,
        });
      }
      return;
    }

    // 중간 승인 → 다음 결재자
    if (kind === 'approved' && doc.status === 'pending') {
      const nextLine = doc.lines.find((l) => l.step === doc.currentStep && l.status === 'pending');
      if (nextLine) {
        await createNotification({
          recipientId: nextLine.approverId,
          actorId,
          type: 'approval_pending',
          title: '결재가 요청되었습니다',
          body: `${doc.drafter?.name ?? ''} — ${baseBody}`,
          link,
          refType: 'approval',
          refId: doc.id,
        });
      }
    }
  }

  /**
   * 문서 상신 시 첫 결재자에게 알림 + 참조자 알림
   * - createDocument(submit=true) 또는 submitDocument 완료 후 호출
   */
  async notifyOnSubmit(documentId: string): Promise<void> {
    const doc = await prisma.approvalDocument.findUnique({
      where: { id: documentId },
      include: {
        drafter: { select: { id: true, name: true } },
        lines: { orderBy: { step: 'asc' }, take: 1 },
        references: { select: { userId: true } },
      },
    });
    if (!doc) return;

    const link = `/approval/documents/${doc.id}`;
    const baseBody = `${doc.drafter?.name ?? ''} — [${doc.docNumber}] ${doc.title}`;
    const firstApproverId = doc.lines[0]?.approverId;

    if (firstApproverId) {
      await createNotification({
        recipientId: firstApproverId,
        actorId: doc.drafterId,
        type: 'approval_pending',
        title: '결재가 요청되었습니다',
        body: baseBody,
        link,
        refType: 'approval',
        refId: doc.id,
      });
    }
    for (const ref of doc.references) {
      await createNotification({
        recipientId: ref.userId,
        actorId: doc.drafterId,
        type: 'approval_reference',
        title: '참조 문서가 등록되었습니다',
        body: baseBody,
        link,
        refType: 'approval',
        refId: doc.id,
      });
    }
  }

  /**
   * 문서 회수 (상신 취소)
   */
  async withdraw(documentId: string, userId: string) {
    const doc = await prisma.approvalDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
    if (doc.drafterId !== userId) throw new AppError(403, 'FORBIDDEN', '본인의 문서만 회수할 수 있습니다');
    if (doc.status !== 'pending') throw new AppError(400, 'INVALID_STATUS', '결재 대기 상태의 문서만 회수할 수 있습니다');

    // 첫 결재자가 아직 미처리일 때만 회수 가능
    const firstLine = await prisma.approvalLine.findFirst({
      where: { documentId, step: 1 },
    });
    if (firstLine && firstLine.status !== 'pending') {
      throw new AppError(400, 'ALREADY_ACTED', '이미 결재가 진행되어 회수할 수 없습니다');
    }

    return prisma.approvalDocument.update({
      where: { id: documentId },
      data: { status: 'withdrawn' },
    });
  }

  /**
   * 문서 목록 (문서함별)
   */
  async getDocuments(userId: string, box: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    let where: Record<string, unknown> = {};

    switch (box) {
      case 'drafts': // 기안함 (내가 작성한 문서)
        where = { drafterId: userId };
        break;
      case 'pending': // 결재함 (내가 결재할 문서)
        where = {
          status: 'pending',
          lines: { some: { approverId: userId, status: 'pending' } },
        };
        break;
      case 'approved': // 완료함
        where = {
          OR: [
            { drafterId: userId, status: { in: ['approved', 'rejected'] } },
            { lines: { some: { approverId: userId, status: { in: ['approved', 'rejected'] } } } },
          ],
        };
        break;
      case 'references': // 참조함
        where = { references: { some: { userId } } };
        break;
      case 'temp': // 임시저장
        where = { drafterId: userId, status: 'draft' };
        break;
      default:
        where = { drafterId: userId };
    }

    const [documents, total] = await Promise.all([
      prisma.approvalDocument.findMany({
        where,
        include: {
          template: { select: { name: true, category: true } },
          drafter: { select: { id: true, name: true, department: { select: { name: true } } } },
          lines: {
            select: { step: true, status: true, approver: { select: { name: true } } },
            orderBy: { step: 'asc' },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.approvalDocument.count({ where }),
    ]);

    return {
      documents,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}

export const approvalService = new ApprovalService();
