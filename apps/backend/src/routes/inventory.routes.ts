import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';

const router = Router();
router.use(checkModule('inventory'));

// ===== 카테고리 =====

router.get('/categories', authenticate, async (_req, res: Response) => {
  try {
    const categories = await prisma.inventoryCategory.findMany({
      where: { isActive: true, parentId: null },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: categories });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/categories', authenticate, authorize('super_admin', 'admin', 'dept_admin'), async (req: Request, res: Response) => {
  try {
    const category = await prisma.inventoryCategory.create({
      data: {
        name: req.body.name,
        parentId: req.body.parentId,
        sortOrder: req.body.sortOrder || 0,
      },
    });
    res.status(201).json({ success: true, data: category });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 자재 =====

const itemSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  categoryId: z.string().uuid().optional(),
  unit: z.string().max(20).default('EA'),
  specification: z.string().max(200).optional(),
  description: z.string().optional(),
  minStock: z.number().int().min(0).default(0),
  unitPrice: z.number().optional(),
  location: z.string().max(100).optional(),
  supplierId: z.string().uuid().optional(),
});

// GET /inventory/items - 자재 목록
router.get('/items', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const categoryId = req.query.categoryId as string;
    const lowStock = req.query.lowStock === 'true';

    const where: any = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (lowStock) {
      where.currentStock = { lte: prisma.inventoryItem.fields.minStock };
      // Use raw filter for comparing columns
      where.AND = [
        ...(where.AND || []),
      ];
    }

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          supplier: { select: { id: true, companyName: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    // 부족재고 필터를 위해 후처리
    const filteredItems = lowStock
      ? items.filter(item => item.currentStock <= item.minStock)
      : items;

    res.json({
      success: true,
      data: filteredItems,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /inventory/items/:id - 자재 상세
router.get('/items/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        supplier: true,
        transactions: {
          include: { processor: { select: { id: true, name: true } } },
          orderBy: { processedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!item || !item.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '자재를 찾을 수 없습니다' } });
      return;
    }
    res.json({ success: true, data: item });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /inventory/items - 자재 등록
router.post('/items', authenticate, authorize('super_admin', 'admin', 'dept_admin'), validate(itemSchema), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.inventoryItem.findUnique({ where: { code: req.body.code } });
    if (existing) {
      res.status(400).json({ success: false, error: { code: 'DUPLICATE_CODE', message: '이미 존재하는 자재코드입니다' } });
      return;
    }

    const item = await prisma.inventoryItem.create({
      data: req.body,
      include: { category: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: item });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /inventory/items/:id - 자재 수정
router.patch('/items/:id', authenticate, authorize('super_admin', 'admin', 'dept_admin'), async (req: Request, res: Response) => {
  try {
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, data: item });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /inventory/items/:id - 자재 비활성화
router.delete('/items/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    await prisma.inventoryItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, data: { message: '자재가 비활성화되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 입출고 =====

const transactionSchema = z.object({
  itemId: z.string().uuid(),
  type: z.enum(['in_stock', 'out_stock', 'return_stock', 'adjust']),
  quantity: z.number().int().min(1),
  unitPrice: z.number().optional(),
  reason: z.string().max(500).optional(),
  reference: z.string().max(100).optional(),
});

// POST /inventory/transactions - 입출고 처리
router.post('/transactions', authenticate, validate(transactionSchema), async (req: Request, res: Response) => {
  try {
    const { itemId, type, quantity, unitPrice, reason, reference } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item || !item.isActive) {
        throw new Error('NOT_FOUND');
      }

      const beforeStock = item.currentStock;
      let afterStock: number;

      switch (type) {
        case 'in_stock':
        case 'return_stock':
          afterStock = beforeStock + quantity;
          break;
        case 'out_stock':
          if (beforeStock < quantity) {
            throw new Error('INSUFFICIENT_STOCK');
          }
          afterStock = beforeStock - quantity;
          break;
        case 'adjust':
          afterStock = quantity; // 조정은 절대값
          break;
        default:
          throw new Error('INVALID_TYPE');
      }

      // 재고 업데이트
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { currentStock: afterStock },
      });

      // 트랜잭션 기록
      const transaction = await tx.inventoryTransaction.create({
        data: {
          itemId,
          type,
          quantity,
          unitPrice,
          totalPrice: unitPrice ? unitPrice * quantity : null,
          beforeStock,
          afterStock,
          reason,
          reference,
          processedBy: req.user!.id,
        },
        include: {
          item: { select: { id: true, name: true, code: true } },
          processor: { select: { id: true, name: true } },
        },
      });

      return transaction;
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '자재를 찾을 수 없습니다' } });
    } else if (err.message === 'INSUFFICIENT_STOCK') {
      res.status(400).json({ success: false, error: { code: 'INSUFFICIENT_STOCK', message: '재고가 부족합니다' } });
    } else {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
    }
  }
});

// GET /inventory/transactions - 입출고 이력
router.get('/transactions', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const itemId = req.query.itemId as string;
    const type = req.query.type as string;

    const where: any = {};
    if (itemId) where.itemId = itemId;
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        include: {
          item: { select: { id: true, name: true, code: true, unit: true } },
          processor: { select: { id: true, name: true } },
        },
        orderBy: { processedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    res.json({ success: true, data: transactions, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 통계 =====

router.get('/stats/summary', authenticate, async (_req, res: Response) => {
  try {
    const [totalItems, lowStockItems, totalValue] = await Promise.all([
      prisma.inventoryItem.count({ where: { isActive: true } }),
      prisma.inventoryItem.findMany({
        where: { isActive: true },
        select: { id: true, currentStock: true, minStock: true },
      }),
      prisma.inventoryItem.findMany({
        where: { isActive: true },
        select: { currentStock: true, unitPrice: true },
      }),
    ]);

    const lowCount = lowStockItems.filter(i => i.currentStock <= i.minStock).length;
    const totalVal = totalValue.reduce((sum, i) => sum + (i.currentStock * (i.unitPrice || 0)), 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTx = await prisma.inventoryTransaction.count({
      where: { processedAt: { gte: todayStart } },
    });

    res.json({
      success: true,
      data: {
        totalItems,
        lowStockCount: lowCount,
        totalValue: Math.round(totalVal),
        todayTransactions: todayTx,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
