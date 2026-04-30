import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/auditLog';
import { approvalService } from '../services/approval.service';
import { AppError } from '../services/auth.service';
import { qs, qsOpt } from '../utils/query';
import { config } from '../config';
import { approvalFileFilter } from '../utils/fileFilter';
import { logger } from '../config/logger';

const router = Router();
router.use(checkModule('approval'));

// ===== 양식 =====

// GET /approvals/templates
router.get('/templates', authenticate, async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.approvalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: templates });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 문서 =====

const createDocSchema = z.object({
  templateId: z.string().uuid(),
  title: z.string().min(1, '제목을 입력해주세요').max(200),
  content: z.string().min(1, '내용을 입력해주세요'),
  formData: z.record(z.unknown()).optional(),
  urgency: z.enum(['normal', 'urgent']).default('normal'),
  approverIds: z.array(z.string().uuid()).min(1, '결재자를 1명 이상 지정해주세요'),
  referenceIds: z.array(z.string().uuid()).optional(),
  submit: z.boolean().default(false),
});

// POST /approvals/documents - 문서 작성
router.post('/documents', authenticate, validate(createDocSchema), async (req: Request, res: Response) => {
  try {
    const { submit, ...data } = req.body;
    const doc = await approvalService.createDocument(req.user!.id, data, submit);

    if (submit) {
      await createAuditLog({ req, action: 'approval_submit', resourceType: 'approval', resourceId: doc.id });
      await approvalService.notifyOnSubmit(doc.id).catch(() => {});
    }

    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /approvals/documents - 문서 목록
router.get('/documents', authenticate, async (req: Request, res: Response) => {
  try {
    const box = qs(req.query.box) || 'drafts';
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;

    const result = await approvalService.getDocuments(req.user!.id, box, page, limit);
    res.json({ success: true, data: result.documents, meta: result.meta });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /approvals/documents/:id - 문서 상세 (기안자/결재자/참조자/관리자만)
router.get('/documents/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await approvalService.getDocumentDetail(
      qs(req.params.id),
      req.user!.id,
      req.user!.role,
    );
    res.json({ success: true, data: doc });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /approvals/documents/:id/submit - 상신
router.post('/documents/:id/submit', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await approvalService.submitDocument(qs(req.params.id), req.user!.id);
    await createAuditLog({ req, action: 'approval_submit', resourceType: 'approval', resourceId: doc.id });
    await approvalService.notifyOnSubmit(doc.id).catch(() => {});
    res.json({ success: true, data: doc });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /approvals/documents/:id/approve - 승인
router.post('/documents/:id/approve', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await approvalService.approve(qs(req.params.id), req.user!.id, req.body.comment);
    await createAuditLog({ req, action: 'approval_approve', resourceType: 'approval', resourceId: doc.id });
    res.json({ success: true, data: doc });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /approvals/documents/:id/reject - 반려
router.post('/documents/:id/reject', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await approvalService.reject(qs(req.params.id), req.user!.id, req.body.comment);
    await createAuditLog({ req, action: 'approval_reject', resourceType: 'approval', resourceId: doc.id, riskLevel: 'medium' });
    res.json({ success: true, data: doc });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /approvals/documents/:id/withdraw - 회수
router.post('/documents/:id/withdraw', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await approvalService.withdraw(qs(req.params.id), req.user!.id);
    if (!doc) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '회수 처리 후 문서를 찾을 수 없습니다' } });
      return;
    }
    await createAuditLog({ req, action: 'approval_withdraw', resourceType: 'approval', resourceId: doc.id });
    res.json({ success: true, data: doc });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /approvals/count - 결재 대기 건수 (본인 + 위임받은 분까지 합산)
router.get('/count', authenticate, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    // 활성 위임 받은 사용자 (위임자) 들의 ID 도 함께 카운트 — 모바일 결재 탭 뱃지 정확성
    const incomingDelegators = await prisma.approvalDelegation.findMany({
      where: {
        toUserId: req.user!.id,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { fromUserId: true },
    });
    const approverIds = [req.user!.id, ...incomingDelegators.map((d) => d.fromUserId)];

    const pendingCount = await prisma.approvalLine.count({
      where: {
        approverId: { in: approverIds },
        status: 'pending',
        document: { status: 'pending' },
      },
    });
    res.json({ success: true, data: { pending: pendingCount } });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 결재 첨부파일 (APR-005, 5개 / 20MB) =====

const MAX_ATTACHMENTS_PER_DOC = 5;
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB

/** 첨부 파일 저장소: uploads/approvals/{documentId}/ */
const approvalStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const documentId = qs(req.params.id);
    const dir = path.resolve(config.upload.dir, 'approvals', documentId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const stored = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    cb(null, stored);
  },
});

const approvalUpload = multer({
  storage: approvalStorage,
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
  fileFilter: approvalFileFilter,
});

/** 첨부 권한 체크: 기안자(draft/pending), 결재자, 위임받은 사용자, 참조자, 관리자 */
async function canAccessAttachment(
  documentId: string,
  userId: string,
  userRole: string,
): Promise<{ ok: true; doc: { drafterId: string; status: string } } | { ok: false; reason: string }> {
  const doc = await prisma.approvalDocument.findUnique({
    where: { id: documentId },
    select: {
      drafterId: true,
      status: true,
      lines: { select: { approverId: true } },
      references: { select: { userId: true } },
    },
  });
  if (!doc) return { ok: false, reason: 'NOT_FOUND' };

  const isAdmin = userRole === 'super_admin' || userRole === 'admin';
  const isDrafter = doc.drafterId === userId;
  const isApprover = doc.lines.some((l) => l.approverId === userId);
  const isReference = doc.references.some((r) => r.userId === userId);

  // 위임 — 결재자 중 누구라도 userId 에게 활성 위임을 만들었으면 접근 가능
  let isDelegate = false;
  if (!isAdmin && !isDrafter && !isApprover && !isReference) {
    const approverIds = doc.lines.map((l) => l.approverId);
    if (approverIds.length > 0) {
      const now = new Date();
      const dlg = await prisma.approvalDelegation.findFirst({
        where: {
          fromUserId: { in: approverIds },
          toUserId: userId,
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
    return { ok: false, reason: 'FORBIDDEN' };
  }
  return { ok: true, doc: { drafterId: doc.drafterId, status: doc.status } };
}

// POST /approvals/documents/:id/attachments — 첨부 업로드
// - 기안자만 업로드 가능
// - draft/pending 상태에서만 (approved/rejected 후엔 변경 불가)
// - 문서당 최대 5개
router.post(
  '/documents/:id/attachments',
  authenticate,
  approvalUpload.single('file'),
  async (req: Request, res: Response) => {
    const documentId = qs(req.params.id);
    const file = req.file;
    const removeUploaded = () => {
      if (file && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      }
    };

    try {
      if (!file) {
        res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '파일이 없습니다' } });
        return;
      }

      const doc = await prisma.approvalDocument.findUnique({
        where: { id: documentId },
        select: { drafterId: true, status: true, _count: { select: { attachments: true } } },
      });
      if (!doc) {
        removeUploaded();
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
        return;
      }
      if (doc.drafterId !== req.user!.id) {
        removeUploaded();
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '기안자만 첨부할 수 있습니다' } });
        return;
      }
      if (doc.status !== 'draft' && doc.status !== 'pending') {
        removeUploaded();
        res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '완료/반려/회수된 문서에는 첨부할 수 없습니다' } });
        return;
      }
      if (doc._count.attachments >= MAX_ATTACHMENTS_PER_DOC) {
        removeUploaded();
        res.status(400).json({
          success: false,
          error: { code: 'TOO_MANY_ATTACHMENTS', message: `문서당 최대 ${MAX_ATTACHMENTS_PER_DOC}개까지 첨부 가능합니다` },
        });
        return;
      }

      const relPath = path.relative(path.resolve(config.upload.dir), file.path);
      const attachment = await prisma.approvalAttachment.create({
        data: {
          documentId,
          fileName: file.originalname,
          filePath: relPath,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      });

      await createAuditLog({ req, action: 'approval_attachment_upload', resourceType: 'approval', resourceId: documentId });
      res.status(201).json({ success: true, data: attachment });
    } catch (err) {
      removeUploaded();
      const isLimit = typeof (err as Error)?.message === 'string' && /large|size/i.test((err as Error).message);
      if (isLimit) {
        res.status(400).json({ success: false, error: { code: 'FILE_TOO_LARGE', message: `파일 크기는 최대 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB 입니다` } });
        return;
      }
      const msg = (err as Error)?.message || '서버 오류';
      res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: msg } });
    }
  },
);

// GET /approvals/documents/:id/attachments — 목록
router.get('/documents/:id/attachments', authenticate, async (req: Request, res: Response) => {
  try {
    const access = await canAccessAttachment(qs(req.params.id), req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const rows = await prisma.approvalAttachment.findMany({
      where: { documentId: qs(req.params.id) },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /approvals/documents/:id/attachments/:attId/file — 다운로드
router.get('/documents/:id/attachments/:attId/file', authenticate, async (req: Request, res: Response) => {
  try {
    const access = await canAccessAttachment(qs(req.params.id), req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }

    const att = await prisma.approvalAttachment.findUnique({ where: { id: qs(req.params.attId) } });
    if (!att || att.documentId !== qs(req.params.id)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }

    const absPath = path.resolve(config.upload.dir, att.filePath);
    // 디렉토리 탈출 방지
    const baseDir = path.resolve(config.upload.dir, 'approvals');
    if (!absPath.startsWith(baseDir)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: '잘못된 경로' } });
      return;
    }
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '파일이 서버에 존재하지 않습니다' } });
      return;
    }

    res.setHeader('Content-Type', att.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
    );
    res.sendFile(absPath);
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /approvals/documents/:id/attachments/:attId — 삭제 (기안자만, draft/pending일 때)
router.delete('/documents/:id/attachments/:attId', authenticate, async (req: Request, res: Response) => {
  try {
    const documentId = qs(req.params.id);
    const attId = qs(req.params.attId);

    const att = await prisma.approvalAttachment.findUnique({
      where: { id: attId },
      include: { document: { select: { drafterId: true, status: true } } },
    });
    if (!att || att.documentId !== documentId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    if (att.document.drafterId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '기안자만 삭제할 수 있습니다' } });
      return;
    }
    if (att.document.status !== 'draft' && att.document.status !== 'pending') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '완료/반려된 문서의 첨부는 삭제할 수 없습니다' } });
      return;
    }

    const absPath = path.resolve(config.upload.dir, att.filePath);
    if (fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch { /* ignore */ }
    }
    await prisma.approvalAttachment.delete({ where: { id: attId } });
    await createAuditLog({ req, action: 'approval_attachment_delete', resourceType: 'approval', resourceId: documentId });
    res.json({ success: true });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
