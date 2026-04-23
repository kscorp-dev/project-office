/**
 * 메일 관리자 API — WorkMail + MailAccount 통합 관리
 *
 * 주요 책임:
 *  1) WorkMail에서 사용자 CRUD → 동시에 Project Office의 MailAccount 레코드 동기화
 *  2) 관리자 비밀번호 생성·저장은 앱에서 암호화해 저장 → 사용자는 WorkMail 비번 몰라도 앱에서 메일 사용 가능
 *  3) 모든 관리자 액션은 MailAdminLog에 감사 기록
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { getWorkMailService } from '../services/workmail.service';
import prisma from '../config/prisma';
import { qs } from '../utils/query';
import { parsePagination, buildMeta } from '../utils/pagination';
import { encryptMailPassword, generateStrongPassword } from '../utils/mailCrypto';
import { AppError } from '../services/auth.service';

const router = Router();
router.use(authenticate, authorize('super_admin', 'admin'));

/** 감사 로그 작성 헬퍼 */
async function logAdminAction(
  actorId: string,
  targetEmail: string,
  action: string,
  details?: Record<string, unknown>,
) {
  try {
    await prisma.mailAdminLog.create({
      data: { actorId, targetEmail, action, details: details as any },
    });
  } catch { /* 감사 로그 실패로 본 작업 막지 않음 */ }
}

/* ──────────── 연결 상태 ──────────── */

router.get('/workmail/health', async (_req: Request, res: Response) => {
  try {
    const wm = getWorkMailService();
    const org = await wm.describeOrganization();
    res.json({
      success: true,
      data: {
        connected: true,
        organization: org,
        endpoints: {
          imap: `${process.env.MAIL_IMAP_HOST}:${process.env.MAIL_IMAP_PORT}`,
          smtp: `${process.env.MAIL_SMTP_HOST}:${process.env.MAIL_SMTP_PORT}`,
        },
      },
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: { code: 'WORKMAIL_UNREACHABLE', message: (err as Error).message },
    });
  }
});

/* ──────────── 사용자 목록 / 상세 ──────────── */

router.get('/workmail/users', async (req: Request, res: Response) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const wm = getWorkMailService();
  const users = await wm.listUsers({ includeDeleted });

  // MailAccount와 조인 (앱에 연결된 계정 표시)
  const emails = users.map((u) => u.email).filter((e): e is string => Boolean(e));
  const accounts = await prisma.mailAccount.findMany({
    where: { email: { in: emails } },
    include: { user: { select: { id: true, name: true, employeeId: true } } },
  });
  const accMap = new Map(accounts.map((a) => [a.email, a]));

  const enriched = users.map((u) => {
    const acc = u.email ? accMap.get(u.email) : undefined;
    return {
      ...u,
      linkedUser: acc?.user ? {
        userId: acc.user.id,
        userName: acc.user.name,
        employeeId: acc.user.employeeId,
      } : null,
      mailAccountId: acc?.id ?? null,
    };
  });

  res.json({ success: true, data: enriched });
});

router.get('/workmail/users/:userId', async (req: Request, res: Response) => {
  const wm = getWorkMailService();
  const detail = await wm.describeUser(qs(req.params.userId));
  res.json({ success: true, data: detail });
});

/* ──────────── 메일박스 생성 (+ 자동 MailAccount 연결) ──────────── */

const createMailboxSchema = z.object({
  username: z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/),
  displayName: z.string().min(1).max(100),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  /** 기존 User와 연결해 앱에서 바로 사용 가능하게 */
  linkUserId: z.string().uuid().optional(),
  /** 비밀번호 미지정 시 강력한 랜덤 비밀번호 자동 생성 */
  password: z.string().min(8).max(64).optional(),
  hiddenFromGAL: z.boolean().optional(),
});

router.post('/workmail/users', validate(createMailboxSchema), async (req: Request, res: Response) => {
  const wm = getWorkMailService();
  const password = req.body.password ?? generateStrongPassword(20);

  const { userId: workmailUserId, email } = await wm.createMailbox({
    username: req.body.username,
    password,
    displayName: req.body.displayName,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    hiddenFromGAL: req.body.hiddenFromGAL,
  });

  let mailAccountId: string | null = null;
  let tempPasswordForReturn: string | null = null;

  if (req.body.linkUserId) {
    // 기존 User와 연결 → 앱에서 바로 메일 사용 가능 (사용자는 비번 몰라도 됨)
    const existingUser = await prisma.user.findUnique({
      where: { id: req.body.linkUserId },
      include: { mailAccount: true },
    });
    if (!existingUser) {
      throw new AppError(404, 'USER_NOT_FOUND', '연결할 사용자를 찾을 수 없습니다');
    }
    if (existingUser.mailAccount) {
      throw new AppError(409, 'ALREADY_LINKED', '이미 메일 계정이 연결된 사용자입니다');
    }

    const account = await prisma.mailAccount.create({
      data: {
        userId: existingUser.id,
        email,
        displayName: req.body.displayName,
        workmailUserId,
        encryptedPassword: encryptMailPassword(password),
      },
    });
    mailAccountId = account.id;
    tempPasswordForReturn = req.body.password ? null : password; // 자동생성 시만 1회 노출
  } else if (!req.body.password) {
    // linkUserId 없으면 비번을 관리자에게 반환 (1회만)
    tempPasswordForReturn = password;
  }

  await logAdminAction(req.user!.id, email, 'create', {
    workmailUserId,
    linkedUserId: req.body.linkUserId,
    autoGenerated: !req.body.password,
  });

  res.status(201).json({
    success: true,
    data: {
      workmailUserId,
      email,
      mailAccountId,
      temporaryPassword: tempPasswordForReturn,
      hint: tempPasswordForReturn
        ? '이 비밀번호는 이 응답에서만 확인 가능합니다. 안전한 곳에 저장하세요.'
        : null,
    },
  });
});

/* ──────────── 기존 WorkMail 계정 → 앱 User와 연결 ──────────── */

const linkSchema = z.object({
  userId: z.string().uuid(),                  // Project Office User ID
  workmailUserId: z.string().min(1),          // WorkMail 내부 UUID
  password: z.string().min(1),                // IMAP/SMTP용 현재 비밀번호
});

router.post('/workmail/link', validate(linkSchema), async (req: Request, res: Response) => {
  const wm = getWorkMailService();
  const wmUser = await wm.describeUser(req.body.workmailUserId);
  if (!wmUser.email) {
    throw new AppError(400, 'NO_EMAIL', 'WorkMail 사용자에 이메일이 없습니다');
  }
  if (wmUser.state !== 'ENABLED') {
    throw new AppError(400, 'NOT_ENABLED', 'WorkMail 계정이 활성 상태가 아닙니다');
  }

  const appUser = await prisma.user.findUnique({
    where: { id: req.body.userId },
    include: { mailAccount: true },
  });
  if (!appUser) throw new AppError(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다');
  if (appUser.mailAccount) throw new AppError(409, 'ALREADY_LINKED', '이미 메일 계정이 연결되어 있습니다');

  const account = await prisma.mailAccount.create({
    data: {
      userId: appUser.id,
      email: wmUser.email,
      displayName: wmUser.displayName || wmUser.name,
      workmailUserId: wmUser.userId,
      quotaMB: wmUser.quotaMB,
      usedMB: wmUser.usedMB,
      encryptedPassword: encryptMailPassword(req.body.password),
    },
  });

  await logAdminAction(req.user!.id, wmUser.email, 'link', {
    workmailUserId: wmUser.userId,
    linkedUserId: appUser.id,
  });

  // 연결 성공 시 해당 계정의 IMAP IDLE 즉시 시작 (실시간 알림 활성화)
  try {
    const { restartMailIdle } = await import('../workers/mailIdle.worker');
    restartMailIdle(account.id).catch(() => { /* 실패해도 연결 자체는 성공 */ });
  } catch { /* idle worker 비활성화 환경 */ }

  res.status(201).json({
    success: true,
    data: { mailAccountId: account.id, email: wmUser.email },
  });
});

/* ──────────── 비밀번호 재설정 ──────────── */

const resetPwSchema = z.object({
  newPassword: z.string().min(8).max(64).optional(),
  /** 지정 안 하면 자동 생성 */
});

router.post(
  '/workmail/users/:userId/reset-password',
  validate(resetPwSchema),
  async (req: Request, res: Response) => {
    const wm = getWorkMailService();
    const wmUserId = qs(req.params.userId);
    const password = req.body.newPassword ?? generateStrongPassword(20);

    await wm.resetPassword(wmUserId, password);

    // MailAccount가 있으면 암호화 비번도 업데이트 → 앱 연동 유지
    const account = await prisma.mailAccount.findUnique({ where: { workmailUserId: wmUserId } });
    if (account) {
      await prisma.mailAccount.update({
        where: { id: account.id },
        data: { encryptedPassword: encryptMailPassword(password), lastSyncError: null },
      });
    }

    await logAdminAction(req.user!.id, account?.email ?? wmUserId, 'reset_password', {
      workmailUserId: wmUserId,
      autoGenerated: !req.body.newPassword,
    });

    res.json({
      success: true,
      data: {
        message: '비밀번호가 재설정되었습니다',
        temporaryPassword: req.body.newPassword ? null : password,
      },
    });
  },
);

/* ──────────── 쿼터 변경 ──────────── */

const quotaSchema = z.object({ quotaMB: z.number().int().min(100).max(51200) });

router.patch(
  '/workmail/users/:userId/quota',
  validate(quotaSchema),
  async (req: Request, res: Response) => {
    const wm = getWorkMailService();
    const wmUserId = qs(req.params.userId);

    await wm.updateQuota(wmUserId, req.body.quotaMB);

    const account = await prisma.mailAccount.findUnique({ where: { workmailUserId: wmUserId } });
    if (account) {
      await prisma.mailAccount.update({
        where: { id: account.id },
        data: { quotaMB: req.body.quotaMB },
      });
    }

    await logAdminAction(req.user!.id, account?.email ?? wmUserId, 'quota', {
      workmailUserId: wmUserId,
      quotaMB: req.body.quotaMB,
    });

    res.json({ success: true, data: { message: '쿼터가 변경되었습니다' } });
  },
);

/* ──────────── 메일박스 삭제 (super_admin만) ──────────── */

router.delete(
  '/workmail/users/:userId',
  authorize('super_admin'),
  async (req: Request, res: Response) => {
    const wm = getWorkMailService();
    const wmUserId = qs(req.params.userId);

    // Cascade: MailAccount 먼저 삭제
    const account = await prisma.mailAccount.findUnique({ where: { workmailUserId: wmUserId } });
    if (account) {
      await prisma.mailAccount.delete({ where: { id: account.id } });
    }

    await wm.deleteMailbox(wmUserId);

    await logAdminAction(req.user!.id, account?.email ?? wmUserId, 'delete', {
      workmailUserId: wmUserId,
    });

    res.json({ success: true, data: { message: '메일박스가 삭제되었습니다' } });
  },
);

/* ──────────── 메일박스 미연결 User 목록 (생성 시 드롭다운용) ──────────── */

router.get('/linkable-users', async (req: Request, res: Response) => {
  const search = qs(req.query.search);
  const users = await prisma.user.findMany({
    where: {
      status: 'active',
      mailAccount: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { employeeId: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      employeeId: true,
      email: true,
      role: true,
      department: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
    take: 100,
  });
  res.json({ success: true, data: users });
});

/* ──────────── 감사 로그 조회 ──────────── */

router.get('/admin-logs', async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 30, maxLimit: 200 });
  const targetEmail = qs(req.query.targetEmail);
  const action = qs(req.query.action);

  const where: Record<string, unknown> = {};
  if (targetEmail) where.targetEmail = targetEmail;
  if (action) where.action = action;

  const [logs, total] = await Promise.all([
    prisma.mailAdminLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, employeeId: true } } },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.mailAdminLog.count({ where }),
  ]);

  res.json({ success: true, data: logs, meta: buildMeta(pagination, total) });
});

export default router;
