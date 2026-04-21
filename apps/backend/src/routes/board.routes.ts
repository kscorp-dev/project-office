import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { checkModule } from '../middleware/checkModule';
import { validate } from '../middleware/validate';
import { qs, qsOpt } from '../utils/query';

const router = Router();
router.use(checkModule('board'));

// ===== 게시판 =====

router.get('/boards', authenticate, async (_req, res: Response) => {
  try {
    const boards = await prisma.board.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: boards });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

router.post('/boards', authenticate, authorize('super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const board = await prisma.board.create({
      data: {
        name: req.body.name,
        type: req.body.type || 'general',
        description: req.body.description,
        departmentId: req.body.departmentId,
        sortOrder: req.body.sortOrder || 0,
      },
    });
    res.status(201).json({ success: true, data: board });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 게시글 =====

const postSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  isPinned: z.boolean().default(false),
  isMustRead: z.boolean().default(false),
});

// GET /board/boards/:boardId/posts - 게시글 목록
router.get('/boards/:boardId/posts', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page)) || 1;
    const limit = parseInt(qs(req.query.limit)) || 20;
    const search = qs(req.query.search);

    const where: any = { boardId: qs(req.params.boardId), isActive: true };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, position: true } },
          _count: { select: { comments: true } },
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    res.json({ success: true, data: posts, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// GET /board/posts/:id - 게시글 상세
router.get('/posts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: qs(req.params.id) },
      include: {
        author: { select: { id: true, name: true, position: true } },
        board: { select: { id: true, name: true } },
        comments: {
          where: { isActive: true, parentId: null },
          include: {
            author: { select: { id: true, name: true } },
            replies: {
              where: { isActive: true },
              include: { author: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        attachments: true,
        _count: { select: { reads: true } },
      },
    });

    if (!post || !post.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '게시글을 찾을 수 없습니다' } });
      return;
    }

    // 조회수 증가 및 읽음 처리
    await Promise.all([
      prisma.post.update({ where: { id: qs(req.params.id) }, data: { viewCount: { increment: 1 } } }),
      prisma.postRead.upsert({
        where: { postId_userId: { postId: qs(req.params.id), userId: req.user!.id } },
        update: { readAt: new Date() },
        create: { postId: qs(req.params.id), userId: req.user!.id },
      }),
    ]);

    res.json({ success: true, data: post });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// POST /board/boards/:boardId/posts - 게시글 작성
router.post('/boards/:boardId/posts', authenticate, validate(postSchema), async (req: Request, res: Response) => {
  try {
    const board = await prisma.board.findUnique({ where: { id: qs(req.params.boardId) } });
    if (!board || !board.isActive) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '게시판을 찾을 수 없습니다' } });
      return;
    }

    // 공지 고정/필독은 관리자만
    if ((req.body.isPinned || req.body.isMustRead) && !['super_admin', 'admin', 'dept_admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '공지 설정 권한이 없습니다' } });
      return;
    }

    const post = await prisma.post.create({
      data: {
        boardId: qs(req.params.boardId),
        authorId: req.user!.id,
        title: req.body.title,
        content: req.body.content,
        isPinned: req.body.isPinned,
        isMustRead: req.body.isMustRead,
      },
      include: {
        author: { select: { id: true, name: true, position: true } },
      },
    });

    res.status(201).json({ success: true, data: post });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// PATCH /board/posts/:id - 게시글 수정 (TOCTOU 방어: 조건부 업데이트)
router.patch('/posts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = qs(req.params.id);
    const isAdmin = ['super_admin', 'admin'].includes(req.user!.role);

    // 작성자 권한 조건을 where에 직접 포함 → TOCTOU 제거
    // 관리자가 아니면 authorId까지 일치해야 업데이트
    const result = await prisma.post.updateMany({
      where: isAdmin
        ? { id: postId, isActive: true }
        : { id: postId, isActive: true, authorId: req.user!.id },
      data: {
        title: req.body.title,
        content: req.body.content,
        isPinned: req.body.isPinned,
        isMustRead: req.body.isMustRead,
      },
    });

    if (result.count === 0) {
      // 존재하지 않거나 권한이 없거나 이미 삭제된 경우 구분
      const exists = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, isActive: true } });
      if (!exists || !exists.isActive) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '게시글을 찾을 수 없습니다' } });
      } else {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '수정 권한이 없습니다' } });
      }
      return;
    }

    const updated = await prisma.post.findUnique({ where: { id: postId } });
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /board/posts/:id - 게시글 삭제 (soft, TOCTOU 방어)
router.delete('/posts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = qs(req.params.id);
    const isAdmin = ['super_admin', 'admin'].includes(req.user!.role);

    const result = await prisma.post.updateMany({
      where: isAdmin
        ? { id: postId, isActive: true }
        : { id: postId, isActive: true, authorId: req.user!.id },
      data: { isActive: false },
    });

    if (result.count === 0) {
      const exists = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, isActive: true } });
      if (!exists || !exists.isActive) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '게시글을 찾을 수 없습니다' } });
      } else {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      }
      return;
    }

    res.json({ success: true, data: { message: '게시글이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// ===== 댓글 =====

const commentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
});

// POST /board/posts/:postId/comments - 댓글 작성
router.post('/posts/:postId/comments', authenticate, validate(commentSchema), async (req: Request, res: Response) => {
  try {
    const comment = await prisma.comment.create({
      data: {
        postId: qs(req.params.postId),
        authorId: req.user!.id,
        content: req.body.content,
        parentId: req.body.parentId,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });
    res.status(201).json({ success: true, data: comment });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

// DELETE /board/comments/:id - 댓글 삭제 (soft)
router.delete('/comments/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const comment = await prisma.comment.findUnique({ where: { id: qs(req.params.id) } });
    if (!comment) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '댓글을 찾을 수 없습니다' } });
      return;
    }
    if (comment.authorId !== req.user!.id && !['super_admin', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '삭제 권한이 없습니다' } });
      return;
    }

    await prisma.comment.update({ where: { id: qs(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, data: { message: '댓글이 삭제되었습니다' } });
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 오류' } });
  }
});

export default router;
