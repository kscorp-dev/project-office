import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/auditLog';
import { approvalService } from '../services/approval.service';
import { AppError } from '../services/auth.service';
import { qs, qsOpt } from '../utils/query';

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
  } catch {
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
  } catch {
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

// GET /approvals/count - 결재 대기 건수
router.get('/count', authenticate, async (req: Request, res: Response) => {
  try {
    const pendingCount = await prisma.approvalLine.count({
      where: {
        approverId: req.user!.id,
        status: 'pending',
        document: { status: 'pending' },
      },
    });
    res.json({ success: true, data: { pending: pendingCount } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
