import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';

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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const priority = req.query.priority as string;
    const search = req.query.search as string;
    const box = req.query.box as string; // sent, received, all

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

    // 체크리스트 진행률 계산
    const tasksWithProgress = await Promise.all(
      tasks.map(async (task) => {
        const checklistTotal = await prisma.taskChecklist.count({ where: { taskId: task.id } });
        const checklistDone = await prisma.taskChecklist.count({ where: { taskId: task.id, isCompleted: true } });
        return {
          ...task,
          progress: checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0,
        };
      })
    );

    res.json({ success: true, data: tasksWithProgress, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /task-orders/:id - 작업지시서 상세
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const task = await prisma.taskOrder.findUnique({
      where: { id: req.params.id },
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

    res.json({ success: true, data: task });
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /task-orders/:id - 작업지시서 수정
router.patch('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const task = await prisma.taskOrder.findUnique({ where: { id: req.params.id } });
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

    const { instructionDate, dueDate, ...rest } = req.body;
    const updated = await prisma.taskOrder.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(instructionDate ? { instructionDate: new Date(instructionDate) } : {}),
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      },
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /task-orders/:id/status - 상태 변경
router.post('/:id/status', authenticate, async (req: Request, res: Response) => {
  try {
    const { status: newStatus, comment } = req.body;
    const task = await prisma.taskOrder.findUnique({
      where: { id: req.params.id },
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
        where: { id: req.params.id },
        data: {
          status: newStatus,
          ...(newStatus === 'final_complete' ? { completedAt: new Date() } : {}),
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: req.params.id,
          fromStatus: task.status,
          toStatus: newStatus,
          changedBy: req.user!.id,
          comment,
        },
      });

      return t;
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /task-orders/:id/comments - 코멘트 추가
router.post('/:id/comments', authenticate, async (req: Request, res: Response) => {
  try {
    const comment = await prisma.taskComment.create({
      data: {
        taskId: req.params.id,
        userId: req.user!.id,
        content: req.body.content,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: comment });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /task-orders/:id/checklist/:checkId - 체크리스트 토글
router.patch('/:id/checklist/:checkId', authenticate, async (req: Request, res: Response) => {
  try {
    const item = await prisma.taskChecklist.findUnique({ where: { id: req.params.checkId } });
    if (!item) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '체크리스트 항목을 찾을 수 없습니다' } });
      return;
    }

    const updated = await prisma.taskChecklist.update({
      where: { id: req.params.checkId },
      data: {
        isCompleted: !item.isCompleted,
        completedBy: !item.isCompleted ? req.user!.id : null,
      },
    });
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /task-orders/:id - 작업지시서 삭제 (soft, draft만)
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const task = await prisma.taskOrder.findUnique({ where: { id: req.params.id } });
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

    await prisma.taskOrder.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, data: { message: '작업지시서가 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 거래처 =====

router.get('/clients/list', authenticate, async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    const where: any = { isActive: true };
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }
    const clients = await prisma.client.findMany({ where, orderBy: { companyName: 'asc' }, take: 50 });
    res.json({ success: true, data: clients });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/clients/create', authenticate, async (req: Request, res: Response) => {
  try {
    const client = await prisma.client.create({ data: req.body });
    res.status(201).json({ success: true, data: client });
  } catch {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
