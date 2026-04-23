/**
 * 사용자 메일 API
 *
 * 로그인된 사용자 본인의 WorkMail 메일박스 조작.
 * 모든 엔드포인트는 authenticate 필수.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { getMailService } from '../services/mail.service';
import { qs, qsOpt } from '../utils/query';
import { parsePagination } from '../utils/pagination';
import { AppError } from '../services/auth.service';

const router = Router();
router.use(authenticate);

/* ────────── Multer (첨부 업로드, 100MB) ────────── */
const MAX_ATTACHMENT_BYTES = parseInt(process.env.MAIL_MAX_ATTACHMENT_SIZE || '104857600', 10);

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
    files: 10,
  },
});

/* ────────── 내 계정 정보 ────────── */

router.get('/account', async (req: Request, res: Response) => {
  const acc = await prisma.mailAccount.findUnique({
    where: { userId: req.user!.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      imapHost: true,
      imapPort: true,
      smtpHost: true,
      smtpPort: true,
      quotaMB: true,
      usedMB: true,
      isActive: true,
      lastSyncAt: true,
      lastSyncError: true,
      createdAt: true,
    },
  });
  res.json({ success: true, data: acc });
});

/** 연결 테스트 (IMAP/SMTP 각각 로그인 시도) */
router.post('/account/test', async (req: Request, res: Response) => {
  const svc = getMailService();
  const result = await svc.testConnection(req.user!.id);
  const ok = result.imap && result.smtp;
  res.status(ok ? 200 : 503).json({
    success: ok,
    data: result,
  });
});

/* ────────── 폴더 목록 ────────── */

router.get('/folders', async (req: Request, res: Response) => {
  const svc = getMailService();
  const folders = await svc.listFolders(req.user!.id);
  res.json({ success: true, data: folders });
});

/* ────────── 메일 목록 ──────────
 * 기본 동작: DB 캐시 우선 응답 (수 ms) + 백그라운드에서 IMAP 갱신 (비동기)
 * ?refresh=1: IMAP 동기 호출 → 최신 결과 반환 + 캐시 업데이트
 * ?search=...: 캐시 스킵, 항상 IMAP 실시간 검색
 */

router.get('/messages', async (req: Request, res: Response) => {
  const folder = qsOpt(req.query.folder) || 'INBOX';
  const pagination = parsePagination(req.query as Record<string, unknown>, {
    defaultLimit: 20,
    maxLimit: 100,
  });
  const search = qsOpt(req.query.search);
  const forceRefresh = qsOpt(req.query.refresh) === '1';

  const userId = req.user!.id;
  const svc = getMailService();

  // 검색은 항상 IMAP 실시간
  if (search) {
    const { items, total } = await svc.listMessages(userId, {
      folder, page: pagination.page, limit: pagination.limit, search,
    });
    res.json({
      success: true, data: items,
      meta: {
        total, page: pagination.page, limit: pagination.limit,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        source: 'imap',
      },
    });
    return;
  }

  // 강제 새로고침: 동기 IMAP 호출
  if (forceRefresh) {
    const { items, total } = await svc.listMessages(userId, {
      folder, page: pagination.page, limit: pagination.limit,
    });
    res.json({
      success: true, data: items,
      meta: {
        total, page: pagination.page, limit: pagination.limit,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        source: 'imap',
      },
    });
    return;
  }

  // 기본: 캐시 반환 + 백그라운드 refresh
  const acc = await prisma.mailAccount.findUnique({ where: { userId } });
  if (!acc) throw new AppError(404, 'MAIL_ACCOUNT_NOT_LINKED', '메일 계정이 연결되지 않았습니다');

  const [cacheItems, cacheTotal] = await Promise.all([
    prisma.mailMessageCache.findMany({
      where: { accountId: acc.id, folder },
      orderBy: { sentAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.mailMessageCache.count({ where: { accountId: acc.id, folder } }),
  ]);

  // 캐시가 비어있으면 동기 IMAP (첫 진입 경험)
  if (cacheItems.length === 0 && pagination.page === 1) {
    try {
      const { items, total } = await svc.listMessages(userId, { folder, page: 1, limit: pagination.limit });
      res.json({
        success: true, data: items,
        meta: {
          total, page: 1, limit: pagination.limit,
          totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
          source: 'imap',
        },
      });
      return;
    } catch (err) {
      // IMAP 실패 시에도 빈 배열 반환 (사용자 경험 유지)
      res.json({ success: true, data: [], meta: { total: 0, page: 1, limit: pagination.limit, totalPages: 1, source: 'empty' } });
      return;
    }
  }

  // 캐시 있으면 즉시 응답 + 백그라운드 refresh
  res.json({
    success: true,
    data: cacheItems.map((m) => ({
      uid: m.uid.toString(),
      messageId: m.messageId,
      subject: m.subject,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      to: m.toJson,
      cc: m.ccJson,
      snippet: m.snippet,
      sentAt: m.sentAt.toISOString(),
      isSeen: m.isSeen,
      isFlagged: m.isFlagged,
      hasAttachment: m.hasAttachment,
      size: m.size,
    })),
    meta: {
      total: cacheTotal,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.max(1, Math.ceil(cacheTotal / pagination.limit)),
      source: 'cache',
      cachedAt: acc.lastSyncAt,
    },
  });

  // 백그라운드 갱신 (응답 반환 후 실행, 클라이언트는 대기 안 함)
  svc.listMessages(userId, { folder, page: pagination.page, limit: pagination.limit })
    .then(async (fresh) => {
      // mailMessageCache upsert (헤더 최신화)
      const ops = fresh.items.map((m) =>
        prisma.mailMessageCache.upsert({
          where: { accountId_folder_uid: { accountId: acc.id, folder, uid: BigInt(m.uid) } },
          update: {
            isSeen: m.isSeen,
            isFlagged: m.isFlagged,
            cachedAt: new Date(),
          },
          create: {
            accountId: acc.id,
            folder,
            uid: BigInt(m.uid),
            messageId: m.messageId || `nomsgid-${m.uid}`,
            subject: m.subject || null,
            fromEmail: m.fromEmail,
            fromName: m.fromName || null,
            toJson: m.to as any,
            ccJson: (m.cc as any) ?? undefined,
            snippet: m.snippet || null,
            sentAt: new Date(m.sentAt),
            isSeen: m.isSeen,
            isFlagged: m.isFlagged,
            hasAttachment: m.hasAttachment,
            size: m.size,
          },
        }),
      );
      await Promise.allSettled(ops);
      await prisma.mailAccount.update({
        where: { id: acc.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    })
    .catch(() => { /* 백그라운드 실패 조용히 무시 */ });
});

/* ────────── 메일 상세 ────────── */

router.get('/messages/:uid', async (req: Request, res: Response) => {
  const folder = qsOpt(req.query.folder) || 'INBOX';
  const svc = getMailService();
  const msg = await svc.getMessage(req.user!.id, folder, qs(req.params.uid));

  // 연락처 자동 학습 (발신자를 주소록에 추가 — 빈도↑)
  if (msg.fromEmail) {
    await prisma.mailContact.upsert({
      where: { userId_email: { userId: req.user!.id, email: msg.fromEmail } },
      update: {
        frequency: { increment: 1 },
        lastUsedAt: new Date(),
        name: msg.fromName || undefined,
      },
      create: {
        userId: req.user!.id,
        email: msg.fromEmail,
        name: msg.fromName || null,
      },
    }).catch(() => { /* 주소록 실패는 본 조회 막지 않음 */ });
  }

  res.json({ success: true, data: msg });
});

/* ────────── 첨부파일 다운로드 (스트림 프록시) ────────── */

router.get('/messages/:uid/attachments/:index', async (req: Request, res: Response) => {
  const folder = qsOpt(req.query.folder) || 'INBOX';
  const uid = qs(req.params.uid);
  const index = parseInt(qs(req.params.index), 10);
  if (!Number.isFinite(index) || index < 0) {
    throw new AppError(400, 'INVALID_INDEX', '첨부파일 인덱스가 잘못되었습니다');
  }

  const svc = getMailService();
  const att = await svc.getAttachment(req.user!.id, folder, uid, index);

  res.setHeader('Content-Type', att.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
  );
  res.setHeader('Content-Length', att.size.toString());
  res.send(att.content);
});

/* ────────── flag 변경 ────────── */

const flagsSchema = z.object({
  folder: z.string().default('INBOX'),
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
});

router.patch('/messages/:uid/flags', validate(flagsSchema), async (req: Request, res: Response) => {
  const svc = getMailService();
  await svc.updateFlags(req.user!.id, req.body.folder, qs(req.params.uid), {
    seen: req.body.seen,
    flagged: req.body.flagged,
  });
  res.json({ success: true, data: { message: 'flag 변경 완료' } });
});

/* ────────── 폴더 이동 ────────── */

const moveSchema = z.object({
  fromFolder: z.string().min(1),
  toFolder: z.string().min(1),
});

router.post('/messages/:uid/move', validate(moveSchema), async (req: Request, res: Response) => {
  const svc = getMailService();
  await svc.moveMessage(req.user!.id, req.body.fromFolder, req.body.toFolder, qs(req.params.uid));
  res.json({ success: true, data: { message: '폴더 이동 완료' } });
});

/* ────────── 삭제 (휴지통으로) ────────── */

router.delete('/messages/:uid', async (req: Request, res: Response) => {
  const folder = qsOpt(req.query.folder) || 'INBOX';
  const svc = getMailService();
  await svc.deleteMessage(req.user!.id, folder, qs(req.params.uid));
  res.json({ success: true, data: { message: '휴지통으로 이동' } });
});

/* ────────── 메일 발송 (첨부 최대 100MB × 10개) ────────── */

router.post('/send', attachmentUpload.array('attachments', 10), async (req: Request, res: Response) => {
  const to = parseAddressList(req.body.to);
  const cc = parseAddressList(req.body.cc);
  const bcc = parseAddressList(req.body.bcc);
  const subject = String(req.body.subject || '').trim();
  const text = req.body.text ? String(req.body.text) : undefined;
  const html = req.body.html ? String(req.body.html) : undefined;

  if (to.length === 0) throw new AppError(400, 'NO_RECIPIENT', '받는 사람이 없습니다');
  if (!subject) throw new AppError(400, 'NO_SUBJECT', '제목이 비어있습니다');
  if (!text && !html) throw new AppError(400, 'NO_BODY', '본문이 비어있습니다');

  const files = (req.files as Express.Multer.File[]) ?? [];
  const attachments = files.map((f) => ({
    filename: f.originalname,
    content: f.buffer,
    contentType: f.mimetype,
  }));

  const svc = getMailService();
  const result = await svc.sendMessage(req.user!.id, { to, cc, bcc, subject, text, html, attachments });

  // 수신자를 주소록에 자동 추가 (빈도 ↑)
  const userId = req.user!.id;
  const recipients = [...to, ...cc, ...bcc];
  await Promise.all(
    recipients.map((email) =>
      prisma.mailContact.upsert({
        where: { userId_email: { userId, email } },
        update: { frequency: { increment: 1 }, lastUsedAt: new Date() },
        create: { userId, email },
      }).catch(() => { /* ignore */ }),
    ),
  );

  res.status(201).json({ success: true, data: result });
});

function parseAddressList(raw: unknown): string[] {
  if (!raw) return [];
  const str = Array.isArray(raw) ? raw.join(',') : String(raw);
  return str
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/* ────────── 주소록 자동완성 ────────── */

router.get('/contacts', async (req: Request, res: Response) => {
  const q = qsOpt(req.query.q) || '';
  const contacts = await prisma.mailContact.findMany({
    where: {
      userId: req.user!.id,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ frequency: 'desc' }, { lastUsedAt: 'desc' }],
    take: 20,
  });
  res.json({ success: true, data: contacts });
});

/* ────────── 캐시된 메시지 목록 (빠른 로드용, 옵션) ────────── */

router.get('/messages/cache/:folder', async (req: Request, res: Response) => {
  const folder = qs(req.params.folder);
  const pagination = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 100 });

  const acc = await prisma.mailAccount.findUnique({ where: { userId: req.user!.id } });
  if (!acc) throw new AppError(404, 'MAIL_ACCOUNT_NOT_LINKED', '메일 계정이 연결되지 않았습니다');

  const [items, total] = await Promise.all([
    prisma.mailMessageCache.findMany({
      where: { accountId: acc.id, folder },
      orderBy: { sentAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.mailMessageCache.count({ where: { accountId: acc.id, folder } }),
  ]);

  res.json({
    success: true,
    data: items.map((m) => ({
      uid: m.uid.toString(),
      messageId: m.messageId,
      subject: m.subject,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      to: m.toJson,
      cc: m.ccJson,
      snippet: m.snippet,
      sentAt: m.sentAt.toISOString(),
      isSeen: m.isSeen,
      isFlagged: m.isFlagged,
      hasAttachment: m.hasAttachment,
      size: m.size,
    })),
    meta: {
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      lastSyncAt: acc.lastSyncAt,
    },
  });
});

export default router;
