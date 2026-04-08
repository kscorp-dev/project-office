import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';

const router = Router();
router.use(checkModule('document'));

// ===== 폴더 =====

const folderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().optional().nullable(),
});

// GET /document/folders - 폴더 목록 (내 소유 + 공유된 폴더, 트리 구조)
router.get('/folders', authenticate, async (req: Request, res: Response) => {
  try {
    const folders = await prisma.documentFolder.findMany({
      where: {
        isActive: true,
        OR: [
          { ownerId: req.user!.id },
          { sharedUsers: { some: { userId: req.user!.id } } },
        ],
      },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { files: true, children: true } },
      },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    });

    // 트리 구조로 변환
    const folderMap = new Map(folders.map(f => [f.id, { ...f, children: [] as any[] }]));
    const roots: any[] = [];

    for (const folder of folderMap.values()) {
      if (folder.parentId && folderMap.has(folder.parentId)) {
        folderMap.get(folder.parentId)!.children.push(folder);
      } else {
        roots.push(folder);
      }
    }

    res.json({ success: true, data: roots });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /document/folders - 폴더 생성
router.post('/folders', authenticate, validate(folderSchema), async (req: Request, res: Response) => {
  try {
    // parentId가 있으면 소유자 또는 공유된 폴더인지 확인
    if (req.body.parentId) {
      const parent = await prisma.documentFolder.findUnique({ where: { id: req.body.parentId } });
      if (!parent || !parent.isActive) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '상위 폴더를 찾을 수 없습니다' } });
        return;
      }
      if (parent.ownerId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '폴더 생성 권한이 없습니다' } });
        return;
      }
    }

    const folder = await prisma.documentFolder.create({
      data: {
        name: req.body.name,
        parentId: req.body.parentId || null,
        ownerId: req.user!.id,
      },
      include: {
        owner: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: folder });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /document/folders/:id - 폴더 수정
router.patch('/folders/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const folder = await prisma.documentFolder.findUnique({ where: { id: req.params.id } });
    if (!folder || !folder.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
      return;
    }
    if (folder.ownerId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } });
      return;
    }

    const updated = await prisma.documentFolder.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        parentId: req.body.parentId !== undefined ? req.body.parentId : undefined,
      },
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /document/folders/:id - 폴더 삭제 (soft)
router.delete('/folders/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const folder = await prisma.documentFolder.findUnique({ where: { id: req.params.id } });
    if (!folder || !folder.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
      return;
    }
    if (folder.ownerId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }

    await prisma.documentFolder.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, data: { message: '폴더가 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 파일 =====

const fileSchema = z.object({
  fileName: z.string().min(1).max(255),
  filePath: z.string().min(1),
  fileSize: z.number().int().min(0),
  mimeType: z.string().min(1).max(100),
  folderId: z.string().uuid().optional().nullable(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  isShared: z.boolean().default(false),
});

// GET /document/files - 파일 목록 (folderId 필터, 이름/태그 검색, 페이지네이션)
router.get('/files', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const folderId = req.query.folderId as string | undefined;
    const search = req.query.search as string | undefined;

    const where: any = {
      isActive: true,
      OR: [
        { uploaderId: req.user!.id },
        { isShared: true },
        { folder: { sharedUsers: { some: { userId: req.user!.id } } } },
      ],
    };

    if (folderId) {
      where.folderId = folderId;
    }
    if (search) {
      where.AND = [
        {
          OR: [
            { fileName: { contains: search, mode: 'insensitive' } },
            { tags: { has: search } },
          ],
        },
      ];
    }

    const [files, total] = await Promise.all([
      prisma.documentFile.findMany({
        where,
        include: {
          uploader: { select: { id: true, name: true } },
          folder: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.documentFile.count({ where }),
    ]);

    res.json({ success: true, data: files, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /document/files/:id - 파일 상세
router.get('/files/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.documentFile.findUnique({
      where: { id: req.params.id },
      include: {
        uploader: { select: { id: true, name: true, position: true } },
        folder: { select: { id: true, name: true } },
      },
    });

    if (!file || !file.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }

    if (file.uploaderId !== req.user!.id && !file.isShared && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' } });
      return;
    }

    res.json({ success: true, data: file });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /document/files - 파일 메타 등록
router.post('/files', authenticate, validate(fileSchema), async (req: Request, res: Response) => {
  try {
    // 폴더가 지정된 경우 존재 여부 확인
    if (req.body.folderId) {
      const folder = await prisma.documentFolder.findUnique({ where: { id: req.body.folderId } });
      if (!folder || !folder.isActive) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
        return;
      }
    }

    const file = await prisma.documentFile.create({
      data: {
        fileName: req.body.fileName,
        filePath: req.body.filePath,
        fileSize: req.body.fileSize,
        mimeType: req.body.mimeType,
        folderId: req.body.folderId || null,
        description: req.body.description,
        tags: req.body.tags || [],
        isShared: req.body.isShared,
        uploaderId: req.user!.id,
      },
      include: {
        uploader: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: file });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /document/files/:id - 파일 수정 (description, tags, isShared)
router.patch('/files/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.documentFile.findUnique({ where: { id: req.params.id } });
    if (!file || !file.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    if (file.uploaderId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } });
      return;
    }

    const updated = await prisma.documentFile.update({
      where: { id: req.params.id },
      data: {
        description: req.body.description,
        tags: req.body.tags,
        isShared: req.body.isShared,
      },
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /document/files/:id - 파일 비활성화 (soft delete)
router.delete('/files/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.documentFile.findUnique({ where: { id: req.params.id } });
    if (!file || !file.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    if (file.uploaderId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }

    await prisma.documentFile.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, data: { message: '파일이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 통계 =====

// GET /document/stats/summary - 통계 (totalFiles, totalFolders, totalSize, sharedFiles)
router.get('/stats/summary', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [totalFiles, totalFolders, sharedFiles, sizeResult] = await Promise.all([
      prisma.documentFile.count({
        where: { uploaderId: userId, isActive: true },
      }),
      prisma.documentFolder.count({
        where: { ownerId: userId, isActive: true },
      }),
      prisma.documentFile.count({
        where: { uploaderId: userId, isActive: true, isShared: true },
      }),
      prisma.documentFile.aggregate({
        where: { uploaderId: userId, isActive: true },
        _sum: { fileSize: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalFiles,
        totalFolders,
        totalSize: sizeResult._sum.fileSize || 0,
        sharedFiles,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
