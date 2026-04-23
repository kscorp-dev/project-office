import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';
import { config } from '../config';
import { makeFileFilter, IMAGE_MIME_MAP, DOCUMENT_MIME_MAP, ARCHIVE_MIME_MAP, MEDIA_MIME_MAP } from '../utils/fileFilter';

const router = Router();
router.use(checkModule('document'));

// ===== 폴더 =====

const folderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().optional().nullable(),
  isShared: z.boolean().optional().default(false),
});

// GET /document/folders - 폴더 목록 (내 소유 + 공유된 폴더, 트리 구조)
router.get('/folders', authenticate, async (req: Request, res: Response) => {
  try {
    const type = qsOpt(req.query.type);

    const where: any = {};
    if (type === 'my') {
      where.ownerId = req.user!.id;
    } else if (type === 'shared') {
      where.isShared = true;
      where.ownerId = { not: req.user!.id };
    } else {
      where.OR = [
        { ownerId: req.user!.id },
        { isShared: true },
      ];
    }

    const folders = await prisma.documentFolder.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { documents: true, children: true } },
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
      if (!parent) {
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
        isShared: req.body.isShared || false,
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
    const folder = await prisma.documentFolder.findUnique({ where: { id: qs(req.params.id) } });
    if (!folder) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
      return;
    }
    if (folder.ownerId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } });
      return;
    }

    const updated = await prisma.documentFolder.update({
      where: { id: qs(req.params.id) },
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

// DELETE /document/folders/:id - 폴더 삭제 (hard delete)
router.delete('/folders/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const folder = await prisma.documentFolder.findUnique({ where: { id: qs(req.params.id) } });
    if (!folder) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
      return;
    }
    if (folder.ownerId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }

    await prisma.documentFolder.delete({ where: { id: qs(req.params.id) } });
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
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const folderId = qsOpt(req.query.folderId);
    const search = qsOpt(req.query.search);

    const where: any = {
      isActive: true,
      OR: [
        { uploaderId: req.user!.id },
        { isShared: true },
        { folder: { isShared: true } },
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
      prisma.document.findMany({
        where,
        include: {
          uploader: { select: { id: true, name: true, position: true } },
          folder: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.document.count({ where }),
    ]);

    // BigInt → Number 변환 + uploadedAt alias
    const serialized = files.map((f: any) => ({
      ...f,
      fileSize: Number(f.fileSize),
      uploadedAt: f.createdAt,
    }));

    res.json({ success: true, data: serialized, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /document/files/:id - 파일 상세
router.get('/files/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.document.findUnique({
      where: { id: qs(req.params.id) },
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

    res.json({
      success: true,
      data: { ...file, fileSize: Number(file.fileSize), uploadedAt: file.createdAt },
    });
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
      if (!folder) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
        return;
      }
    }

    const file = await prisma.document.create({
      data: {
        fileName: req.body.fileName,
        filePath: req.body.filePath,
        fileSize: BigInt(req.body.fileSize),
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

    res.status(201).json({
      success: true,
      data: { ...file, fileSize: Number(file.fileSize), uploadedAt: file.createdAt },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /document/files/:id - 파일 수정 (description, tags, isShared)
router.patch('/files/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.document.findUnique({ where: { id: qs(req.params.id) } });
    if (!file || !file.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    if (file.uploaderId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } });
      return;
    }

    const updated = await prisma.document.update({
      where: { id: qs(req.params.id) },
      data: {
        description: req.body.description,
        tags: req.body.tags,
        isShared: req.body.isShared,
      },
    });

    res.json({ success: true, data: { ...updated, fileSize: Number(updated.fileSize) } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /document/files/:id - 파일 비활성화 (soft delete)
router.delete('/files/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.document.findUnique({ where: { id: qs(req.params.id) } });
    if (!file || !file.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }
    if (file.uploaderId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }

    await prisma.document.update({ where: { id: qs(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, data: { message: '파일이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /document/files/:id/download - 다운로드 카운트 증가
router.post('/files/:id/download', authenticate, async (req: Request, res: Response) => {
  try {
    const file = await prisma.document.findUnique({ where: { id: qs(req.params.id) } });
    if (!file || !file.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } });
      return;
    }

    const updated = await prisma.document.update({
      where: { id: qs(req.params.id) },
      data: { downloadCount: { increment: 1 } },
    });

    res.json({ success: true, data: { downloadCount: updated.downloadCount } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 실제 파일 업로드 / 다운로드 / 버전 관리 =====

// MIME: 이미지 + 문서 + 아카이브 + 미디어 모두 허용 (문서관리 특성)
const DOCUMENT_UPLOAD_MIME: Record<string, readonly string[]> = {
  ...IMAGE_MIME_MAP,
  ...DOCUMENT_MIME_MAP,
  ...ARCHIVE_MIME_MAP,
  ...MEDIA_MIME_MAP,
};
const documentFileFilter = makeFileFilter(DOCUMENT_UPLOAD_MIME);

/** 저장소: uploads/documents/{uploaderId}/ */
const documentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const uploaderId = req.user!.id;
    const dir = path.resolve(config.upload.dir, 'documents', uploaderId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

const documentUpload = multer({
  storage: documentStorage,
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter: documentFileFilter,
});

/** 문서 접근 권한: 업로더 본인 + 공유(isShared=true) + 관리자 */
function canAccessDocument(doc: { uploaderId: string; isShared: boolean }, userId: string, role: string): boolean {
  if (doc.uploaderId === userId) return true;
  if (doc.isShared) return true;
  if (role === 'super_admin' || role === 'admin') return true;
  return false;
}

// POST /document/upload — 실제 파일 업로드 (신규 문서)
router.post('/upload', authenticate, documentUpload.single('file'), async (req: Request, res: Response) => {
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

    const folderId = req.body.folderId || null;
    if (folderId) {
      const folder = await prisma.documentFolder.findUnique({ where: { id: folderId } });
      if (!folder) {
        removeUploaded();
        res.status(404).json({ success: false, error: { code: 'FOLDER_NOT_FOUND', message: '폴더를 찾을 수 없습니다' } });
        return;
      }
    }

    const relPath = path.relative(path.resolve(config.upload.dir), file.path);
    const tags = typeof req.body.tags === 'string'
      ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : (Array.isArray(req.body.tags) ? req.body.tags : []);

    const doc = await prisma.document.create({
      data: {
        fileName: file.originalname,
        filePath: relPath,
        fileSize: BigInt(file.size),
        mimeType: file.mimetype,
        folderId,
        description: req.body.description,
        tags,
        isShared: req.body.isShared === 'true' || req.body.isShared === true,
        uploaderId: req.user!.id,
        version: 1,
      },
      include: {
        uploader: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({
      success: true,
      data: { ...doc, fileSize: Number(doc.fileSize), uploadedAt: doc.createdAt },
    });
  } catch (err) {
    removeUploaded();
    const msg = (err as Error)?.message || '서버 오류';
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: msg } });
  }
});

// POST /document/files/:id/upload-version — 새 버전 업로드
// - 기존 Document row는 그대로, 이전 파일을 DocumentVersion으로 이관, Document를 새 파일로 대체, version +1
router.post(
  '/files/:id/upload-version',
  authenticate,
  documentUpload.single('file'),
  async (req: Request, res: Response) => {
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

      const docId = qs(req.params.id);
      const existing = await prisma.document.findUnique({ where: { id: docId } });
      if (!existing || !existing.isActive) {
        removeUploaded();
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
        return;
      }
      if (existing.uploaderId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
        removeUploaded();
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '업로더만 새 버전을 등록할 수 있습니다' } });
        return;
      }

      const relPath = path.relative(path.resolve(config.upload.dir), file.path);

      const updated = await prisma.$transaction(async (tx) => {
        // 기존 버전을 DocumentVersion으로 이관
        await tx.documentVersion.create({
          data: {
            documentId: docId,
            version: existing.version,
            fileName: existing.fileName,
            filePath: existing.filePath,
            fileSize: existing.fileSize,
            mimeType: existing.mimeType,
            uploaderId: existing.uploaderId,
            changeNote: req.body.previousNote,
          },
        });

        // 새 버전으로 Document 업데이트
        return tx.document.update({
          where: { id: docId },
          data: {
            fileName: file.originalname,
            filePath: relPath,
            fileSize: BigInt(file.size),
            mimeType: file.mimetype,
            version: existing.version + 1,
          },
          include: {
            uploader: { select: { id: true, name: true } },
            folder: { select: { id: true, name: true } },
          },
        });
      });

      res.json({
        success: true,
        data: { ...updated, fileSize: Number(updated.fileSize) },
      });
    } catch (err) {
      removeUploaded();
      const msg = (err as Error)?.message || '서버 오류';
      res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: msg } });
    }
  },
);

// GET /document/files/:id/file — 현재 버전 파일 다운로드 (바이너리)
router.get('/files/:id/file', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: qs(req.params.id) } });
    if (!doc || !doc.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
      return;
    }
    if (!canAccessDocument(doc, req.user!.id, req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' } });
      return;
    }

    const absPath = path.resolve(config.upload.dir, doc.filePath);
    const baseDir = path.resolve(config.upload.dir, 'documents');
    if (!absPath.startsWith(baseDir) || !fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '파일이 존재하지 않습니다' } });
      return;
    }

    // 다운로드 카운트 비동기 증가
    prisma.document.update({
      where: { id: doc.id },
      data: { downloadCount: { increment: 1 } },
    }).catch(() => { /* ignore */ });

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    );
    res.sendFile(absPath);
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /document/files/:id/versions — 버전 이력 조회
router.get('/files/:id/versions', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: qs(req.params.id) } });
    if (!doc || !doc.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
      return;
    }
    if (!canAccessDocument(doc, req.user!.id, req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' } });
      return;
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { version: 'desc' },
    });
    res.json({
      success: true,
      data: {
        current: { version: doc.version, fileName: doc.fileName, fileSize: Number(doc.fileSize), updatedAt: doc.updatedAt },
        history: versions.map((v) => ({ ...v, fileSize: Number(v.fileSize) })),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /document/files/:id/versions/:ver/file — 특정 과거 버전 다운로드
router.get('/files/:id/versions/:ver/file', authenticate, async (req: Request, res: Response) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: qs(req.params.id) } });
    if (!doc || !doc.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다' } });
      return;
    }
    if (!canAccessDocument(doc, req.user!.id, req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' } });
      return;
    }

    const ver = parseInt(String(req.params.ver), 10);
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: doc.id, version: ver } },
    });
    if (!version) {
      res.status(404).json({ success: false, error: { code: 'VERSION_NOT_FOUND', message: '해당 버전을 찾을 수 없습니다' } });
      return;
    }

    const absPath = path.resolve(config.upload.dir, version.filePath);
    const baseDir = path.resolve(config.upload.dir, 'documents');
    if (!absPath.startsWith(baseDir) || !fs.existsSync(absPath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '버전 파일이 존재하지 않습니다' } });
      return;
    }

    res.setHeader('Content-Type', version.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(version.fileName)}`,
    );
    res.sendFile(absPath);
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 통계 =====

// GET /document/stats - 통계 (totalFiles, totalFolders, totalSize, sharedFiles)
router.get('/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [totalFiles, totalFolders, sharedFiles, sizeResult] = await Promise.all([
      prisma.document.count({
        where: { uploaderId: userId, isActive: true },
      }),
      prisma.documentFolder.count({
        where: { ownerId: userId },
      }),
      prisma.document.count({
        where: { uploaderId: userId, isActive: true, isShared: true },
      }),
      prisma.document.aggregate({
        where: { uploaderId: userId, isActive: true },
        _sum: { fileSize: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalFiles,
        totalFolders,
        totalSize: Number(sizeResult._sum.fileSize || 0),
        sharedFiles,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
