import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/auditLog';
import { qs, qsOpt } from '../utils/query';
import { wouldCreateCycle as checkCycle } from '../utils/departmentTree';

const router = Router();

const createDeptSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_]+$/),
  parentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const updateDeptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// GET /departments - 부서 목록 (트리 구조)
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      where: { isActive: true },
      include: {
        manager: { select: { id: true, name: true, position: true, profileImage: true } },
        _count: { select: { users: true } },
      },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });

    // 트리 구조로 변환
    const tree = buildTree(departments);
    res.json({ success: true, data: tree });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// GET /departments/flat - 부서 목록 (플랫)
router.get('/flat', authenticate, async (_req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, parentId: true, depth: true, sortOrder: true },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });
    res.json({ success: true, data: departments });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// GET /departments/:id - 부서 상세
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const dept = await prisma.department.findUnique({
      where: { id: qs(req.params.id) },
      include: {
        manager: { select: { id: true, name: true, position: true } },
        parent: { select: { id: true, name: true, code: true } },
        children: { select: { id: true, name: true, code: true }, where: { isActive: true } },
        users: {
          select: { id: true, name: true, employeeId: true, position: true, role: true, profileImage: true },
          where: { status: 'active' },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!dept) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '부서를 찾을 수 없습니다' } });
      return;
    }

    res.json({ success: true, data: dept });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// POST /departments - 부서 생성
router.post('/', authenticate, authorize('super_admin', 'admin'), validate(createDeptSchema), async (req: Request, res: Response) => {
  try {
    const { parentId, ...rest } = req.body;

    // 부서코드 중복 확인
    const existing = await prisma.department.findUnique({ where: { code: rest.code } });
    if (existing) {
      res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: '이미 존재하는 부서 코드입니다' } });
      return;
    }

    let depth = 0;
    if (parentId) {
      const parent = await prisma.department.findUnique({ where: { id: parentId } });
      if (!parent) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PARENT', message: '상위 부서를 찾을 수 없습니다' } });
        return;
      }
      depth = parent.depth + 1;
    }

    const dept = await prisma.department.create({
      data: { ...rest, parentId, depth },
    });

    await createAuditLog({ req, action: 'department_create', resourceType: 'department', resourceId: dept.id });
    res.status(201).json({ success: true, data: dept });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

/**
 * Prisma 기반 Department 부모 조회기 (순환 검증용)
 */
const deptLookup = {
  findParent: (id: string) => prisma.department.findUnique({
    where: { id },
    select: { parentId: true },
  }),
};

/**
 * 부서 트리에서 순환 참조 검사 (utils/departmentTree의 BFS 재사용)
 */
async function wouldCreateCycle(deptId: string, newParentId: string): Promise<boolean> {
  return checkCycle(deptId, newParentId, deptLookup);
}

// PATCH /departments/:id - 부서 수정
router.patch('/:id', authenticate, authorize('super_admin', 'admin'), validate(updateDeptSchema), async (req: Request, res: Response) => {
  try {
    const deptId = qs(req.params.id);
    const dept = await prisma.department.findUnique({ where: { id: deptId } });
    if (!dept) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '부서를 찾을 수 없습니다' } });
      return;
    }

    // 자기 자신을 상위 부서로 지정 방지
    if (req.body.parentId === deptId) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PARENT', message: '자기 자신을 상위 부서로 지정할 수 없습니다' } });
      return;
    }

    // 순환 참조 방지: newParent가 자기 자신의 자손이면 거부
    if (req.body.parentId && req.body.parentId !== dept.parentId) {
      const cycle = await wouldCreateCycle(deptId, req.body.parentId);
      if (cycle) {
        res.status(400).json({
          success: false,
          error: { code: 'CYCLE_DETECTED', message: '순환 참조를 일으키는 상위 부서 지정입니다' },
        });
        return;
      }

      // depth 재계산 필요
      const newParent = await prisma.department.findUnique({
        where: { id: req.body.parentId },
        select: { depth: true },
      });
      if (!newParent) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PARENT', message: '상위 부서를 찾을 수 없습니다' } });
        return;
      }
      req.body.depth = newParent.depth + 1;
    } else if (req.body.parentId === null) {
      // 루트로 이동
      req.body.depth = 0;
    }

    const updated = await prisma.department.update({
      where: { id: deptId },
      data: req.body,
    });

    await createAuditLog({ req, action: 'department_update', resourceType: 'department', resourceId: updated.id });
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// DELETE /departments/:id - 부서 비활성화
router.delete('/:id', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const dept = await prisma.department.findUnique({
      where: { id: qs(req.params.id) },
      include: { _count: { select: { users: true, children: true } } },
    });

    if (!dept) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '부서를 찾을 수 없습니다' } });
      return;
    }

    if (dept._count.users > 0) {
      res.status(400).json({ success: false, error: { code: 'HAS_USERS', message: '소속 사용자가 있는 부서는 삭제할 수 없습니다' } });
      return;
    }

    if (dept._count.children > 0) {
      res.status(400).json({ success: false, error: { code: 'HAS_CHILDREN', message: '하위 부서가 있는 부서는 삭제할 수 없습니다' } });
      return;
    }

    await prisma.department.update({
      where: { id: qs(req.params.id) },
      data: { isActive: false },
    });

    await createAuditLog({ req, action: 'department_delete', resourceType: 'department', resourceId: qs(req.params.id) });
    res.json({ success: true, data: { message: '부서가 비활성화되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다' } });
  }
});

// 트리 구조 빌드 헬퍼
function buildTree(departments: any[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];

  for (const dept of departments) {
    map.set(dept.id, { ...dept, children: [] });
  }

  for (const dept of departments) {
    const node = map.get(dept.id)!;
    if (dept.parentId && map.has(dept.parentId)) {
      map.get(dept.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export default router;
