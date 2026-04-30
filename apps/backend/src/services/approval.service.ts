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

    // 결재선 무결성 검증 (audit 10A)
    //  1) drafter 가 본인 결재선에 포함되면 자기 결재 우회 가능 → 차단
    //  2) 같은 결재자 중복 시 두 번째 라인 영원히 stuck → 차단
    if (data.approverIds.includes(drafterId)) {
      throw new AppError(400, 'SELF_APPROVAL', '본인을 결재자로 지정할 수 없습니다');
    }
    const uniqueApprovers = new Set(data.approverIds);
    if (uniqueApprovers.size !== data.approverIds.length) {
      throw new AppError(400, 'DUPLICATE_APPROVER', '결재선에 중복된 결재자가 있습니다');
    }

    const docNumber = await this.generateDocNumber(template.code);

    // 결재 문서 + 결재선 + 참조자 + (휴가 양식이면 vacation 까지) 트랜잭션
    // default 5초가 짧을 수 있어 15초 + maxWait 5초 명시 (audit ops H3)
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
    }, {
      timeout: 15_000, // 휴가 양식 등 부하 시 5초 초과 가능
      maxWait: 5_000,
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

      // 위임 권한도 포함 — approver 들 중 누구라도 requesterId 에게 활성 위임을 만들었으면 조회 가능
      // (approve/reject 는 이미 위임 인식하므로 detail 조회도 일치시켜야 UI 모순 없음)
      let isDelegate = false;
      if (!isAdmin && !isDrafter && !isApprover && !isReference) {
        const approverIds = doc.lines.map((l) => l.approverId);
        if (approverIds.length > 0) {
          const now = new Date();
          const dlg = await prisma.approvalDelegation.findFirst({
            where: {
              fromUserId: { in: approverIds },
              toUserId: requesterId,
              isActive: true,
              startDate: { lte: now },
              endDate: { gte: now },
            },
            select: { id: true },
          });
          isDelegate = !!dlg;
        }
      }

      if (!isAdmin && !isDrafter && !isApprover && !isReference && !isDelegate) {
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
      const auth = await canActOnLine(currentLine, approverId, tx);
      if (!auth.asOriginal && !auth.viaDelegation) {
        throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
      }
      // 위임을 통한 자기 결재 우회 차단 (audit 11차 C1)
      // 시나리오: A 기안 → 결재선 B → B가 A에게 위임 → A 가 본인 문서 자기 결재
      // createDocument 의 SELF_APPROVAL 검증을 위임으로 우회 가능했음
      if (auth.viaDelegation && approverId === doc.drafterId) {
        throw new AppError(403, 'SELF_APPROVAL_VIA_DELEGATION',
          '위임을 통한 자기 결재는 허용되지 않습니다');
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
      const auth = await canActOnLine(currentLine, approverId, tx);
      if (!auth.asOriginal && !auth.viaDelegation) {
        throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
      }
      // 위임을 통한 자기 결재 우회 차단 (audit 11차 C1)
      if (auth.viaDelegation && approverId === doc.drafterId) {
        throw new AppError(403, 'SELF_APPROVAL_VIA_DELEGATION',
          '위임을 통한 자기 결재(반려)는 허용되지 않습니다');
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
   * 문서 회수 (상신 취소) — 동시 approve 와 race 방지 (audit 7차 H1)
   *   find→update 사이에 approve 가 들어오면 둘 다 적용될 수 있어, 트랜잭션 + 조건부
   *   updateMany 로 직렬화. 결재가 1단계라도 이미 처리됐으면 0건 update → 409.
   */
  async withdraw(documentId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const doc = await tx.approvalDocument.findUnique({
        where: { id: documentId },
        include: { lines: { orderBy: { step: 'asc' } } },
      });
      if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
      if (doc.drafterId !== userId) throw new AppError(403, 'FORBIDDEN', '본인의 문서만 회수할 수 있습니다');
      if (doc.status !== 'pending') throw new AppError(400, 'INVALID_STATUS', '결재 대기 상태의 문서만 회수할 수 있습니다');
      // 어떤 라인도 이미 처리됐으면 회수 불가
      if (doc.lines.some((l) => l.status !== 'pending')) {
        throw new AppError(400, 'ALREADY_ACTED', '이미 결재가 진행되어 회수할 수 없습니다');
      }
      // 조건부 update — 동시 approve 가 currentStep 변경 / status pending → not 으로 옮겼다면 0건
      const result = await tx.approvalDocument.updateMany({
        where: {
          id: documentId,
          status: 'pending',
          currentStep: doc.currentStep,
          // 모든 라인이 여전히 pending 인지 (재확인)
          lines: { every: { status: 'pending' } },
        },
        data: { status: 'withdrawn' },
      });
      if (result.count === 0) {
        throw new AppError(409, 'CONCURRENT_UPDATE', '다른 요청에 의해 상태가 변경되었습니다');
      }
      return tx.approvalDocument.findUnique({ where: { id: documentId } });
    });
  }

  /**
   * 문서 목록 (문서함별)
   */
  async getDocuments(userId: string, box: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    let where: Record<string, unknown> = {};

    // 활성 위임 받은 사용자 ID 들 — 결재 대기/완료 목록에 위임자의 결재 문서도 포함시키기 위함
    const now = new Date();
    const incomingDelegators = await prisma.approvalDelegation.findMany({
      where: {
        toUserId: userId,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { fromUserId: true },
    });
    const delegatorIds = incomingDelegators.map((d) => d.fromUserId);
    const approverIdsForMatching = [userId, ...delegatorIds];

    switch (box) {
      case 'drafts': // 기안함 (내가 작성한 문서)
        where = { drafterId: userId };
        break;
      case 'pending': // 결재함 (내가 결재할 문서 + 위임 받은 결재)
        where = {
          status: 'pending',
          lines: { some: { approverId: { in: approverIdsForMatching }, status: 'pending' } },
        };
        break;
      case 'approved': // 완료함 (내가 처리한 결재 + 위임 처리한 결재)
        //   actedByUserId 가 본인이거나 line.approverId 가 본인이거나 위임 처리 시 actedBy=본인
        where = {
          OR: [
            { drafterId: userId, status: { in: ['approved', 'rejected'] } },
            { lines: { some: { approverId: userId, status: { in: ['approved', 'rejected'] } } } },
            // 위임으로 본인이 처리한 라인 — actedByUserId 매칭
            { lines: { some: { actedByUserId: userId } } },
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
