import prisma from '../config/prisma';
import { AppError } from './auth.service';

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
   */
  async getDocumentDetail(documentId: string) {
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
   */
  async approve(documentId: string, approverId: string, comment?: string) {
    const doc = await prisma.approvalDocument.findUnique({
      where: { id: documentId },
      include: { lines: { orderBy: { step: 'asc' } } },
    });

    if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
    if (doc.status !== 'pending') throw new AppError(400, 'INVALID_STATUS', '결재 대기 상태가 아닙니다');

    const currentLine = doc.lines.find((l) => l.step === doc.currentStep && l.status === 'pending');
    if (!currentLine || currentLine.approverId !== approverId) {
      throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
    }

    const isLastStep = doc.currentStep >= doc.lines.length;

    await prisma.$transaction(async (tx) => {
      // 현재 결재선 승인
      await tx.approvalLine.update({
        where: { id: currentLine.id },
        data: { status: 'approved', comment, actedAt: new Date() },
      });

      // 마지막 결재자면 문서 최종 승인
      if (isLastStep) {
        await tx.approvalDocument.update({
          where: { id: documentId },
          data: { status: 'approved', completedAt: new Date() },
        });
      } else {
        await tx.approvalDocument.update({
          where: { id: documentId },
          data: { currentStep: doc.currentStep + 1 },
        });
      }
    });

    return this.getDocumentDetail(documentId);
  }

  /**
   * 결재 반려
   */
  async reject(documentId: string, approverId: string, comment: string) {
    if (!comment) throw new AppError(400, 'COMMENT_REQUIRED', '반려 사유를 입력해주세요');

    const doc = await prisma.approvalDocument.findUnique({
      where: { id: documentId },
      include: { lines: { orderBy: { step: 'asc' } } },
    });

    if (!doc) throw new AppError(404, 'NOT_FOUND', '문서를 찾을 수 없습니다');
    if (doc.status !== 'pending') throw new AppError(400, 'INVALID_STATUS', '결재 대기 상태가 아닙니다');

    const currentLine = doc.lines.find((l) => l.step === doc.currentStep && l.status === 'pending');
    if (!currentLine || currentLine.approverId !== approverId) {
      throw new AppError(403, 'NOT_YOUR_TURN', '현재 결재 순서가 아닙니다');
    }

    await prisma.$transaction(async (tx) => {
      await tx.approvalLine.update({
        where: { id: currentLine.id },
        data: { status: 'rejected', comment, actedAt: new Date() },
      });

      await tx.approvalDocument.update({
        where: { id: documentId },
        data: { status: 'rejected', completedAt: new Date() },
      });
    });

    return this.getDocumentDetail(documentId);
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
