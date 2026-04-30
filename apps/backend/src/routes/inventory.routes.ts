import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';
import { logger } from '../config/logger';

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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const search = qs(req.query.search);
    const categoryId = qs(req.query.categoryId);
    const lowStock = req.query.lowStock === 'true';

    const where: any = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    // currentStock <= minStock 비교는 Prisma 가 column-vs-column 을 직접 지원하지 않으므로
    // raw SQL 로 ID 후보 추출 후 in-memory IN 필터 (페이지네이션 + total 정확성 유지)
    if (lowStock) {
      const lowStockRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM inventory_items
        WHERE is_active = true
          AND current_stock <= min_stock
      `;
      const lowIds = lowStockRows.map((r) => r.id);
      where.id = { in: lowIds.length > 0 ? lowIds : ['__none__'] };
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

    res.json({
      success: true,
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /inventory/lookup?code=ABC-001 - 바코드/QR 스캔 lookup (모바일)
//   code 필드에 정확히 일치하는 자재를 1건 반환 (없으면 404).
//   바코드 스캐너로 읽은 문자열이 code 필드와 1:1 대응 — 존재 시 즉시 자재 상세 진입 가능
router.get('/lookup', authenticate, async (req: Request, res: Response) => {
  try {
    const code = qsOpt(req.query.code)?.trim();
    if (!code) {
      res.status(400).json({ success: false, error: { code: 'CODE_REQUIRED', message: '코드 파라미터가 필요합니다' } });
      return;
    }
    const item = await prisma.inventoryItem.findUnique({
      where: { code },
      include: {
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, companyName: true } },
      },
    });
    if (!item || !item.isActive) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '해당 코드의 자재가 없습니다' },
      });
      return;
    }
    res.json({ success: true, data: item });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /inventory/items/:id - 자재 상세
router.get('/items/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: qs(req.params.id) },
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /inventory/items/:id - 자재 수정 (mass assignment 방지를 위해 schema 검증)
router.patch('/items/:id', authenticate, authorize('super_admin', 'admin', 'dept_admin'), validate(itemSchema.partial()), async (req: Request, res: Response) => {
  try {
    const item = await prisma.inventoryItem.update({
      where: { id: qs(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: item });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /inventory/items/:id - 자재 비활성화
router.delete('/items/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    await prisma.inventoryItem.update({ where: { id: qs(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, data: { message: '자재가 비활성화되었습니다' } });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const itemId = qs(req.query.itemId);
    const type = qs(req.query.type);

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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
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
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// 월별 재고 추이 (선 그래프용)
router.get('/stats/stock-trend', authenticate, async (req: Request, res: Response) => {
  try {
    const months = Math.min(parseInt(qs(req.query.months)) || 6, 12);
    const now = new Date();

    // 월 라벨 생성 (최근 N개월)
    const labels: string[] = [];
    const monthBounds: Date[] = []; // 각 월의 마지막 날 23:59:59
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`);
      // 해당 월의 마지막 시점 (다음 달 1일 00:00:00)
      const endOfMonth = i === 0 ? now : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      monthBounds.push(endOfMonth);
    }

    // 활성 자재 + 현재 재고
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, currentStock: true, unit: true },
      orderBy: { name: 'asc' },
    });

    // 기간 내 트랜잭션 (최신순)
    const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { processedAt: { gte: startDate } },
      select: { itemId: true, type: true, quantity: true, processedAt: true },
      orderBy: { processedAt: 'desc' },
    });

    // 아이템별 트랜잭션 그룹화
    const txByItem: Record<string, typeof transactions> = {};
    for (const tx of transactions) {
      (txByItem[tx.itemId] ??= []).push(tx);
    }

    // 각 아이템의 월별 재고 계산 (현재→과거 역산)
    const series: { id: string; name: string; code: string; unit: string; data: number[] }[] = [];

    for (const item of items) {
      const itemTxs = txByItem[item.id] || [];
      const data = new Array(months).fill(0);
      let stock = item.currentStock;

      // 가장 최근 월부터 역순으로 채움
      let txIdx = 0;
      for (let m = months - 1; m >= 0; m--) {
        // 이 월의 경계보다 이후 트랜잭션을 역산
        while (txIdx < itemTxs.length && itemTxs[txIdx].processedAt > monthBounds[m]) {
          const tx = itemTxs[txIdx];
          // 트랜잭션을 되돌림: 입고/반품이었으면 빼고, 출고였으면 더함
          if (tx.type === 'in_stock' || tx.type === 'return_stock') {
            stock -= tx.quantity;
          } else if (tx.type === 'out_stock') {
            stock += tx.quantity;
          } else if (tx.type === 'adjust') {
            // adjust는 정확한 역산 불가, 무시
          }
          txIdx++;
        }
        data[m] = Math.max(0, stock);
      }

      // 변동이 있었거나 현재 재고가 0이 아닌 경우만 포함
      const hasActivity = itemTxs.length > 0 || item.currentStock > 0;
      if (hasActivity) {
        series.push({ id: item.id, name: item.name, code: item.code, unit: item.unit, data });
      }
    }

    // 재고가 많은 상위 10개
    series.sort((a, b) => {
      const aMax = Math.max(...a.data);
      const bMax = Math.max(...b.data);
      return bMax - aMax;
    });

    res.json({
      success: true,
      data: { labels, series: series.slice(0, 10) },
    });
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
