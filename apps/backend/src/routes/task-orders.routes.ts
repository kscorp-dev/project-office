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
import { logger } from '../config/logger';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';
import { config } from '../config';
import { makeFileFilter, IMAGE_MIME_MAP, DOCUMENT_MIME_MAP, ARCHIVE_MIME_MAP } from '../utils/fileFilter';
import { createNotification } from '../services/notification.service';

const router = Router();
router.use(checkModule('task_orders'));

// ===== 작업지시서번호 생성 =====
async function generateTaskNumber(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `T${dateStr}`;

  const last = await prisma.taskOrder.findFirst({
    where: { taskNumber: { startsWith: prefix } },
    orderBy: { taskNumber: 'desc' },
  });

  const seq = last ? parseInt(last.taskNumber.slice(-5)) + 1 : 1;
  return `${prefix}${seq.toString().padStart(5, '0')}`;
}

// 상태 전환 규칙
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['instructed', 'discarded'],
  instructed: ['in_progress', 'discarded'],
  in_progress: ['partial_complete', 'work_complete'],
  partial_complete: ['work_complete'],
  work_complete: ['billing_complete', 'final_complete'],
  billing_complete: ['final_complete'],
};

// ===== 작업지시서 =====

const taskOrderSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  category: z.string().max(50).optional(),
  instructionDate: z.string().optional(),
  dueDate: z.string().optional(),
  clientId: z.string().uuid().optional(),
  deliveryAddress: z.any().optional(),
  additionalNote: z.string().optional(),
  assignees: z.array(z.object({
    userId: z.string().uuid(),
    role: z.string().default('main'),
  })).optional(),
  items: z.array(z.object({
    itemName: z.string().min(1),
    description: z.string().optional(),
    quantity: z.number().default(1),
    unit: z.string().optional(),
    unitPrice: z.number().optional(),
    note: z.string().optional(),
  })).optional(),
  checklist: z.array(z.string()).optional(),
  billing: z.object({
    billingRequired: z.boolean(),
    billingType: z.enum(['tax_invoice', 'cash_receipt', 'other']).optional(),
    amount: z.number().optional(),
    vatIncluded: z.boolean().default(true),
    noBillingReason: z.string().optional(),
  }).optional(),
});

// GET /task-orders - 작업지시서 목록
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const status = qs(req.query.status);
    const priority = qs(req.query.priority);
    const search = qs(req.query.search);
    const box = qs(req.query.box); // sent, received, all

    const where: any = { isActive: true };

    if (box === 'sent') {
      where.creatorId = req.user!.id;
    } else if (box === 'received') {
      where.assignees = { some: { userId: req.user!.id } };
    } else {
      where.OR = [
        { creatorId: req.user!.id },
        { assignees: { some: { userId: req.user!.id } } },
      ];
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { taskNumber: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [tasks, total] = await Promise.all([
      prisma.taskOrder.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, position: true } },
          client: { select: { id: true, companyName: true } },
          assignees: { include: { user: { select: { id: true, name: true } } } },
          _count: { select: { comments: true, checklist: true, designFiles: true } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.taskOrder.count({ where }),
    ]);

    // 체크리스트 진행률 계산 — v0.19.0 성능 최적화: N+1 제거
    // GROUP BY로 한 번에 모든 task의 total/done 집계
    const taskIds = tasks.map((t) => t.id);
    let progressMap = new Map<string, { total: number; done: number }>();
    if (taskIds.length > 0) {
      const agg = await prisma.taskChecklist.groupBy({
        by: ['taskId', 'isCompleted'],
        where: { taskId: { in: taskIds } },
        _count: { _all: true },
      });
      for (const row of agg) {
        const cur = progressMap.get(row.taskId) ?? { total: 0, done: 0 };
        cur.total += row._count._all;
        if (row.isCompleted) cur.done += row._count._all;
        progressMap.set(row.taskId, cur);
      }
    }
    const tasksWithProgress = tasks.map((task) => {
      const p = progressMap.get(task.id) ?? { total: 0, done: 0 };
      return {
        ...task,
        progress: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0,
      };
    });

    res.json({ success: true, data: tasksWithProgress, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /task-orders/:id - 작업지시서 상세
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const task = await prisma.taskOrder.findUnique({
      where: { id: qs(req.params.id) },
      include: {
        creator: { select: { id: true, name: true, position: true, department: { select: { name: true } } } },
        client: true,
        assignees: { include: { user: { select: { id: true, name: true, position: true } } } },
        items: { orderBy: { sortOrder: 'asc' } },
        billing: true,
        checklist: { orderBy: { sortOrder: 'asc' } },
        comments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        statusHistory: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { changedAt: 'asc' },
        },
        designFiles: {
          where: { isLatest: true },
          include: { uploader: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!task || !task.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '작업지시서를 찾을 수 없습니다' } });
      return;
    }

    // 권한: 작성자 / 배정자 / 관리자만 (영업·단가·거래처 IDOR 차단)
    const isAdmin = ['super_admin', 'admin'].includes(req.user!.role);
    const isCreator = task.creatorId === req.user!.id;
    const isAssignee = task.assignees.some((a) => a.userId === req.user!.id);
    if (!isAdmin && !isCreator && !isAssignee) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '이 작업지시서를 조회할 권한이 없습니다' } });
      return;
    }

    res.json({ success: true, data: task });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /task-orders - 작업지시서 작성
router.post('/', authenticate, validate(taskOrderSchema), async (req: Request, res: Response) => {
  try {
    const { assignees, items, checklist, billing, instructionDate, dueDate, ...data } = req.body;
    const taskNumber = await generateTaskNumber();

    const task = await prisma.$transaction(async (tx) => {
      const newTask = await tx.taskOrder.create({
        data: {
          ...data,
          taskNumber,
          creatorId: req.user!.id,
          instructionDate: instructionDate ? new Date(instructionDate) : null,
          dueDate: dueDate ? new Date(dueDate) : null,
          assignees: assignees ? {
            create: assignees.map((a: any) => ({ userId: a.userId, role: a.role || 'main' })),
          } : undefined,
          items: items ? {
            create: items.map((item: any, i: number) => ({
              ...item,
              totalPrice: item.unitPrice ? item.quantity * item.unitPrice : null,
              sortOrder: i,
            })),
          } : undefined,
          checklist: checklist ? {
            create: checklist.map((c: string, i: number) => ({ content: c, sortOrder: i })),
          } : undefined,
        },
        include: {
          creator: { select: { id: true, name: true } },
          assignees: { include: { user: { select: { id: true, name: true } } } },
          items: true,
          checklist: true,
        },
      });

      if (billing) {
        await tx.taskBilling.create({
          data: { taskId: newTask.id, ...billing },
        });
      }

      // 상태 이력 기록
      await tx.taskStatusHistory.create({
        data: {
          taskId: newTask.id,
          fromStatus: null,
          toStatus: 'draft',
          changedBy: req.user!.id,
          comment: '작업지시서 작성',
        },
      });

      return newTask;
    });

    res.status(201).json({ success: true, data: task });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /task-orders/:id - 작업지시서 수정
router.patch('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const task = await prisma.taskOrder.findUnique({ where: { id: qs(req.params.id) } });
    if (!task || !task.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '작업지시서를 찾을 수 없습니다' } });
      return;
    }
    if (task.creatorId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } });
      return;
    }
    if (!['draft', 'instructed'].includes(task.status)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '현재 상태에서는 수정할 수 없습니다' } });
      return;
    }

    // mass assignment 방지 — 화이트리스트 (creatorId/taskNumber/createdAt 등 변경 불가)
    // status 는 PATCH 에서 제외 — POST /:id/status 가 STATUS_TRANSITIONS 검증 후 변경
    // (PATCH 로 직접 status='final_complete' 같은 우회 차단)
    // completedAt 도 PATCH 제외 — 정상 완료 흐름에서만 자동 set
    const {
      title, description, priority, category,
      clientId, deliveryAddress, additionalNote,
      instructionDate, dueDate,
    } = req.body as Record<string, unknown>;
    const updated = await prisma.taskOrder.update({
      where: { id: qs(req.params.id) },
      data: {
        ...(title !== undefined ? { title: title as string } : {}),
        ...(description !== undefined ? { description: description as string | null } : {}),
        ...(priority !== undefined ? { priority: priority as any } : {}),
        ...(category !== undefined ? { category: category as string | null } : {}),
        ...(clientId !== undefined ? { clientId: clientId as string | null } : {}),
        ...(deliveryAddress !== undefined ? { deliveryAddress: deliveryAddress as any } : {}),
        ...(additionalNote !== undefined ? { additionalNote: additionalNote as string | null } : {}),
        ...(instructionDate ? { instructionDate: new Date(instructionDate as string) } : {}),
        ...(dueDate ? { dueDate: new Date(dueDate as string) } : {}),
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /task-orders/:id/status - 상태 변경
router.post('/:id/status', authenticate, async (req: Request, res: Response) => {
  try {
    const { status: newStatus, comment } = req.body;
    const task = await prisma.taskOrder.findUnique({
      where: { id: qs(req.params.id) },
      include: { assignees: true },
    });

    if (!task || !task.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '작업지시서를 찾을 수 없습니다' } });
      return;
    }

    // 권한 체크: 작성자 또는 담당자
    const isCreator = task.creatorId === req.user!.id;
    const isAssignee = task.assignees.some(a => a.userId === req.user!.id);
    const isAdmin = ['super_admin', 'admin'].includes(req.user!.role);

    if (!isCreator && !isAssignee && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '권한이 없습니다' } });
      return;
    }

    // 상태 전환 규칙 체크
    const allowed = STATUS_TRANSITIONS[task.status];
    if (!allowed || !allowed.includes(newStatus)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TRANSITION', message: `${task.status}에서 ${newStatus}(으)로 변경할 수 없습니다` } });
      return;
    }

    // 폐기 시 사유 필수
    if (newStatus === 'discarded' && !comment) {
      res.status(400).json({ success: false, error: { code: 'COMMENT_REQUIRED', message: '폐기 사유를 입력해야 합니다' } });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.taskOrder.update({
        where: { id: qs(req.params.id) },
        data: {
          status: newStatus,
          ...(newStatus === 'final_complete' ? { completedAt: new Date() } : {}),
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: qs(req.params.id),
          fromStatus: task.status,
          toStatus: newStatus,
          changedBy: req.user!.id,
          comment,
        },
      });

      return t;
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /task-orders/:id/comments - 코멘트 추가
router.post('/:id/comments', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    // 권한: 작성자/배정자/관리자만 댓글 작성 가능 (IDOR 방지)
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const content = String(req.body?.content ?? '').trim();
    if (!content) {
      res.status(400).json({ success: false, error: { code: 'CONTENT_REQUIRED', message: '내용을 입력하세요' } });
      return;
    }
    const comment = await prisma.taskComment.create({
      data: {
        taskId,
        userId: req.user!.id,
        content: content.slice(0, 5000),
      },
      include: { user: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /task-orders/:id/checklist/:checkId - 체크리스트 토글
router.patch('/:id/checklist/:checkId', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    // 권한: 작성자/배정자/관리자만 체크리스트 토글 가능
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const item = await prisma.taskChecklist.findUnique({ where: { id: qs(req.params.checkId) } });
    if (!item || item.taskId !== taskId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '체크리스트 항목을 찾을 수 없습니다' } });
      return;
    }

    const updated = await prisma.taskChecklist.update({
      where: { id: qs(req.params.checkId) },
      data: {
        isCompleted: !item.isCompleted,
        completedBy: !item.isCompleted ? req.user!.id : null,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /task-orders/:id - 작업지시서 삭제 (soft, draft만)
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const task = await prisma.taskOrder.findUnique({ where: { id: qs(req.params.id) } });
    if (!task) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '작업지시서를 찾을 수 없습니다' } });
      return;
    }
    if (task.creatorId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }
    if (task.status !== 'draft') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '임시저장 상태에서만 삭제 가능합니다. 폐기를 이용해주세요.' } });
      return;
    }

    await prisma.taskOrder.update({ where: { id: qs(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, data: { message: '작업지시서가 삭제되었습니다' } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 거래처 =====

router.get('/clients/list', authenticate, async (req: Request, res: Response) => {
  try {
    const search = qs(req.query.search);
    const where: any = { isActive: true };
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }
    // 간단한 무한 스크롤/검색용 상한 — 필요 시 pagination으로 교체
    const limit = Math.min(parseInt(qs(req.query.limit) || '50', 10) || 50, 200);
    const clients = await prisma.client.findMany({ where, orderBy: { companyName: 'asc' }, take: limit });
    res.json({ success: true, data: clients });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/clients/create', authenticate, async (req: Request, res: Response) => {
  try {
    const client = await prisma.client.create({ data: req.body });
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 통계 =====

router.get('/stats/summary', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [sent, received, inProgress, overdue] = await Promise.all([
      prisma.taskOrder.count({ where: { creatorId: userId, isActive: true } }),
      prisma.taskOrder.count({ where: { assignees: { some: { userId } }, isActive: true } }),
      prisma.taskOrder.count({
        where: {
          OR: [{ creatorId: userId }, { assignees: { some: { userId } } }],
          status: 'in_progress',
          isActive: true,
        },
      }),
      prisma.taskOrder.count({
        where: {
          OR: [{ creatorId: userId }, { assignees: { some: { userId } } }],
          status: { in: ['instructed', 'in_progress', 'partial_complete'] },
          dueDate: { lt: new Date() },
          isActive: true,
        },
      }),
    ]);

    res.json({ success: true, data: { sent, received, inProgress, overdue } });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 디자인 파일 (DESIGN-001~012) =====
//
// 권한:
//   - 작성자(creator) + 배정자(assignees) + 관리자만 조회/업로드/다운로드
//   - 승인(approve/reject)은 작성자 본인만
//
// 기능:
//   - 업로드 (신규) + 새 버전 (같은 파일명 여러 개 아님, parentFileId로 체인)
//   - 다운로드 시 TaskFileLog 자동 기록 (action=download)
//   - 조회(view) 시에도 로그 + "디자인파일 확인" 이력
//   - 승인/반려 — approveComment, 자동 TaskFileLog 기록

// 디자인 파일: 이미지 + 문서 + 아카이브 + 주요 디자인 포맷
const DESIGN_MIME: Record<string, readonly string[]> = {
  ...IMAGE_MIME_MAP,
  ...DOCUMENT_MIME_MAP,
  ...ARCHIVE_MIME_MAP,
  '.ai':  ['application/postscript', 'application/illustrator', 'application/octet-stream'],
  '.psd': ['image/vnd.adobe.photoshop', 'application/octet-stream'],
  '.eps': ['application/postscript', 'application/eps', 'application/x-eps'],
  '.indd':['application/x-indesign', 'application/octet-stream'],
  '.sketch': ['application/zip', 'application/octet-stream'],
  '.fig': ['application/octet-stream'],
};
const designFileFilter = makeFileFilter(DESIGN_MIME);

const designStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const taskId = qs(req.params.id);
    const dir = path.resolve(config.upload.dir, 'tasks', taskId, 'designs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

const designUpload = multer({
  storage: designStorage,
  limits: { fileSize: config.upload.maxFileSize }, // 50MB 기본 (env로 조정)
  fileFilter: designFileFilter,
});

function detectFileType(mime: string, ext: string): string {
  const e = ext.toLowerCase();
  if (['.ai', '.psd', '.eps', '.indd', '.sketch', '.fig'].includes(e)) return e.slice(1);
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

/** 태스크 접근 권한: 작성자 / 배정자 / 관리자 */
async function canAccessTask(taskId: string, userId: string, role: string): Promise<{ ok: true; task: { creatorId: string } } | { ok: false; reason: string }> {
  const task = await prisma.taskOrder.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  const isAdmin = role === 'super_admin' || role === 'admin';
  const isCreator = task.creatorId === userId;
  const isAssignee = task.assignees.some((a) => a.userId === userId);
  if (!isAdmin && !isCreator && !isAssignee) return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true, task: { creatorId: task.creatorId } };
}

async function logFileAction(params: {
  taskId: string;
  fileId: string;
  userId: string;
  action: 'upload' | 'download' | 'view' | 'approve' | 'reject';
  fileVersion: number;
  comment?: string;
  req?: Request;
}): Promise<void> {
  try {
    await prisma.taskFileLog.create({
      data: {
        taskId: params.taskId,
        fileId: params.fileId,
        userId: params.userId,
        action: params.action,
        fileVersion: params.fileVersion,
        comment: params.comment,
        ipAddress: params.req?.ip,
        deviceType: params.req?.headers['user-agent']?.slice(0, 100),
      },
    });
  } catch { /* ignore — 로그 실패는 본 기능 막지 않음 */ }
}

// GET /:id/design-files — 목록 (현재 버전만 isLatest=true)
router.get('/:id/design-files', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const rows = await prisma.taskDesignFile.findMany({
      where: { taskId, isLatest: true },
      include: {
        uploader: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, fileSize: Number(r.fileSize) })),
    });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /:id/design-files — 신규 업로드
router.post(
  '/:id/design-files',
  authenticate,
  designUpload.single('file'),
  async (req: Request, res: Response) => {
    const taskId = qs(req.params.id);
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
      const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
      if (!access.ok) {
        removeUploaded();
        const status = access.reason === 'NOT_FOUND' ? 404 : 403;
        res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
        return;
      }

      const relPath = path.relative(path.resolve(config.upload.dir), file.path);
      const ext = path.extname(file.originalname);
      const fileType = detectFileType(file.mimetype, ext);

      const created = await prisma.taskDesignFile.create({
        data: {
          taskId,
          fileName: file.originalname,
          filePath: relPath,
          fileSize: BigInt(file.size),
          fileType,
          mimeType: file.mimetype,
          version: 1,
          uploadedBy: req.user!.id,
          isLatest: true,
        },
      });

      await logFileAction({
        taskId,
        fileId: created.id,
        userId: req.user!.id,
        action: 'upload',
        fileVersion: 1,
        req,
      });

      // 작성자에게 알림 (업로더 본인이 아니면)
      if (access.task.creatorId !== req.user!.id) {
        await createNotification({
          recipientId: access.task.creatorId,
          actorId: req.user!.id,
          type: 'task_status_changed',
          title: '디자인파일이 업로드되었습니다',
          body: file.originalname,
          link: `/task-orders/${taskId}`,
          refType: 'task',
          refId: taskId,
        }).catch(() => {});
      }

      res.status(201).json({
        success: true,
        data: { ...created, fileSize: Number(created.fileSize) },
      });
    } catch (err) {
      removeUploaded();
      logger.error({ err, userId: req.user?.id }, '작업지시서 디자인 파일 업로드 실패');
      res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: '업로드에 실패했습니다' } });
    }
  },
);

// POST /:id/design-files/:fileId/upload-version — 새 버전 업로드 (이전 것 isLatest=false)
router.post(
  '/:id/design-files/:fileId/upload-version',
  authenticate,
  designUpload.single('file'),
  async (req: Request, res: Response) => {
    const taskId = qs(req.params.id);
    const fileId = qs(req.params.fileId);
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
      const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
      if (!access.ok) {
        removeUploaded();
        const status = access.reason === 'NOT_FOUND' ? 404 : 403;
        res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
        return;
      }

      const previous = await prisma.taskDesignFile.findUnique({ where: { id: fileId } });
      if (!previous || previous.taskId !== taskId) {
        removeUploaded();
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '원본 파일을 찾을 수 없습니다' } });
        return;
      }

      const relPath = path.relative(path.resolve(config.upload.dir), file.path);
      const ext = path.extname(file.originalname);
      const fileType = detectFileType(file.mimetype, ext);
      const newVersion = previous.version + 1;

      const created = await prisma.$transaction(async (tx) => {
        // 기존 버전 isLatest=false
        await tx.taskDesignFile.update({
          where: { id: fileId },
          data: { isLatest: false },
        });

        return tx.taskDesignFile.create({
          data: {
            taskId,
            fileName: file.originalname,
            filePath: relPath,
            fileSize: BigInt(file.size),
            fileType,
            mimeType: file.mimetype,
            version: newVersion,
            uploadedBy: req.user!.id,
            parentFileId: previous.parentFileId ?? fileId, // 체인 유지
            isLatest: true,
          },
        });
      });

      await logFileAction({
        taskId,
        fileId: created.id,
        userId: req.user!.id,
        action: 'upload',
        fileVersion: newVersion,
        req,
      });

      res.status(201).json({
        success: true,
        data: { ...created, fileSize: Number(created.fileSize) },
      });
    } catch (err) {
      removeUploaded();
      logger.error({ err, userId: req.user?.id }, '작업지시서 디자인 파일 버전 업로드 실패');
      res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: '업로드에 실패했습니다' } });
    }
  },
);

// GET /:id/design-files/:fileId/download — 바이너리 + 로그 자동 기록
router.get('/:id/design-files/:fileId/download', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    const fileId = qs(req.params.fileId);
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }

    const file = await prisma.taskDesignFile.findUnique({ where: { id: fileId } });
    if (!file || file.taskId !== taskId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }

    const absPath = path.resolve(config.upload.dir, file.filePath);
    const baseDir = path.resolve(config.upload.dir, 'tasks');
    if (!absPath.startsWith(baseDir) || !fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '파일이 서버에 없습니다' } });
      return;
    }

    // 로그 자동 기록 (DESIGN-005)
    await logFileAction({
      taskId, fileId, userId: req.user!.id, action: 'download',
      fileVersion: file.version, req,
    });

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.sendFile(absPath);
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /:id/design-files/:fileId/view — 조회 이력 기록 (DESIGN-006 "확인")
router.post('/:id/design-files/:fileId/view', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    const fileId = qs(req.params.fileId);
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const file = await prisma.taskDesignFile.findUnique({ where: { id: fileId } });
    if (!file || file.taskId !== taskId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    await logFileAction({
      taskId, fileId, userId: req.user!.id, action: 'view',
      fileVersion: file.version, req,
    });
    res.json({ success: true });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /:id/design-files/:fileId/approve — 승인 (작성자만)
const approveSchema = z.object({ comment: z.string().max(1000).optional() });
router.post(
  '/:id/design-files/:fileId/approve',
  authenticate,
  validate(approveSchema),
  async (req: Request, res: Response) => {
    try {
      const taskId = qs(req.params.id);
      const fileId = qs(req.params.fileId);
      const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
      if (!access.ok) {
        const status = access.reason === 'NOT_FOUND' ? 404 : 403;
        res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
        return;
      }
      const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
      if (!isAdmin && access.task.creatorId !== req.user!.id) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '작성자만 승인할 수 있습니다' } });
        return;
      }

      const file = await prisma.taskDesignFile.findUnique({ where: { id: fileId } });
      if (!file || file.taskId !== taskId) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
        return;
      }
      if (file.isApproved) {
        res.status(400).json({ success: false, error: { code: 'ALREADY_APPROVED', message: '이미 승인된 파일입니다' } });
        return;
      }

      const updated = await prisma.taskDesignFile.update({
        where: { id: fileId },
        data: {
          isApproved: true,
          approvedBy: req.user!.id,
          approvedAt: new Date(),
          approveComment: req.body.comment,
        },
      });

      await logFileAction({
        taskId, fileId, userId: req.user!.id, action: 'approve',
        fileVersion: file.version, comment: req.body.comment, req,
      });

      // 업로더에게 알림
      await createNotification({
        recipientId: file.uploadedBy,
        actorId: req.user!.id,
        type: 'task_status_changed',
        title: '디자인파일이 승인되었습니다',
        body: `${file.fileName}${req.body.comment ? ` — ${req.body.comment}` : ''}`,
        link: `/task-orders/${taskId}`,
        refType: 'task',
        refId: taskId,
      }).catch(() => {});

      res.json({ success: true, data: { ...updated, fileSize: Number(updated.fileSize) } });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// POST /:id/design-files/:fileId/reject — 반려 (approveComment 필수)
const rejectSchema = z.object({ comment: z.string().min(1).max(1000) });
router.post(
  '/:id/design-files/:fileId/reject',
  authenticate,
  validate(rejectSchema),
  async (req: Request, res: Response) => {
    try {
      const taskId = qs(req.params.id);
      const fileId = qs(req.params.fileId);
      const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
      if (!access.ok) {
        const status = access.reason === 'NOT_FOUND' ? 404 : 403;
        res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
        return;
      }
      const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
      if (!isAdmin && access.task.creatorId !== req.user!.id) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '작성자만 반려할 수 있습니다' } });
        return;
      }

      const file = await prisma.taskDesignFile.findUnique({ where: { id: fileId } });
      if (!file || file.taskId !== taskId) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
        return;
      }

      await logFileAction({
        taskId, fileId, userId: req.user!.id, action: 'reject',
        fileVersion: file.version, comment: req.body.comment, req,
      });

      // 업로더에게 알림
      await createNotification({
        recipientId: file.uploadedBy,
        actorId: req.user!.id,
        type: 'task_status_changed',
        title: '디자인파일이 반려되었습니다',
        body: `${file.fileName} — ${req.body.comment}`,
        link: `/task-orders/${taskId}`,
        refType: 'task',
        refId: taskId,
      }).catch(() => {});

      res.json({ success: true });
    } catch (err) {
      logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  },
);

// GET /:id/design-files/:fileId/versions — 버전 체인 조회
router.get('/:id/design-files/:fileId/versions', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const file = await prisma.taskDesignFile.findUnique({ where: { id: qs(req.params.fileId) } });
    if (!file || file.taskId !== taskId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    // parentFileId 체인 따라 찾기 (첫 parent = rootId)
    const rootId = file.parentFileId ?? file.id;
    const versions = await prisma.taskDesignFile.findMany({
      where: {
        OR: [{ id: rootId }, { parentFileId: rootId }],
      },
      include: {
        uploader: { select: { id: true, name: true } },
      },
      orderBy: { version: 'desc' },
    });
    res.json({
      success: true,
      data: versions.map((v) => ({ ...v, fileSize: Number(v.fileSize) })),
    });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /:id/design-files/:fileId/logs — 파일별 접근 로그 (작성자/관리자만)
router.get('/:id/design-files/:fileId/logs', authenticate, async (req: Request, res: Response) => {
  try {
    const taskId = qs(req.params.id);
    const fileId = qs(req.params.fileId);
    const access = await canAccessTask(taskId, req.user!.id, req.user!.role);
    if (!access.ok) {
      const status = access.reason === 'NOT_FOUND' ? 404 : 403;
      res.status(status).json({ success: false, error: { code: access.reason, message: '접근 권한이 없습니다' } });
      return;
    }
    const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
    if (!isAdmin && access.task.creatorId !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '작성자/관리자만 로그 조회 가능' } });
      return;
    }
    const logs = await prisma.taskFileLog.findMany({
      where: { taskId, fileId },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: logs });
  } catch (err) {
    logger.warn({ err, path: req.path, method: req.method }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
