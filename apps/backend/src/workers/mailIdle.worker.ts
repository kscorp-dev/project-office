/**
 * MailIdleManager
 *
 * 각 활성 MailAccount에 대해 **별도의** IMAP 연결을 유지한다 (기존 mail.service.ts의
 * 요청용 풀과는 분리 — IDLE은 연결을 장기간 점유하기 때문).
 *
 * 동작:
 *  1. 서버 기동 시 모든 active MailAccount에 대해 IDLE 시작
 *  2. INBOX의 `exists`/`expunge`/`flags` 이벤트 감지
 *  3. Socket.IO /mail 네임스페이스로 사용자에게 emit
 *  4. 연결 끊기면 지수 백오프로 재연결 (1s, 2s, 4s, ..., 최대 60s)
 *
 * 제약:
 *  - IMAP IDLE은 RFC 상 29분마다 재발행해야 함 (imapflow는 자동 처리)
 *  - WorkMail의 IMAP 동시 연결 수 제한 (조직당 수백 개 — 소규모는 여유)
 */
import { ImapFlow, type MailboxObject } from 'imapflow';
import prisma from '../config/prisma';
import { logger } from '../config/logger';
import { decryptMailPassword } from '../utils/mailCrypto';
import { emitMailNew, emitMailExpunge, emitMailFlags, emitIdleStatus } from '../websocket/mail';

interface IdleEntry {
  userId: string;
  accountId: string;
  email: string;
  client: ImapFlow | null;
  reconnectTimer: NodeJS.Timeout | null;
  backoffMs: number;
  lastUid: number;          // 마지막으로 본 최대 UID (exists 이벤트 시 새 UID 판단용)
  stopped: boolean;
}

const idleMap = new Map<string, IdleEntry>();   // key = accountId
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/* ───────────────────────── 외부 API ───────────────────────── */

export async function startAllMailIdle(): Promise<void> {
  const accounts = await prisma.mailAccount.findMany({
    where: { isActive: true },
    select: { id: true, userId: true, email: true, imapHost: true, imapPort: true, encryptedPassword: true },
  });
  for (const acc of accounts) {
    startIdleForAccount(acc.id).catch((err) => {
      logger.warn({ accountId: acc.id, err: (err as Error).message }, '[mail-idle] start failed');
    });
  }
  logger.info({ accounts: accounts.length }, '[mail-idle] Started for all active accounts');
}

export async function stopAllMailIdle(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [accountId, entry] of idleMap.entries()) {
    entry.stopped = true;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    if (entry.client) {
      tasks.push(entry.client.logout().catch(() => { /* ignore */ }));
    }
    idleMap.delete(accountId);
  }
  await Promise.allSettled(tasks);
  logger.info('[mail-idle] Stopped all');
}

/** 새 계정이 추가되거나 비밀번호가 변경되었을 때 호출 */
export async function restartMailIdle(accountId: string): Promise<void> {
  const existing = idleMap.get(accountId);
  if (existing) {
    existing.stopped = true;
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    if (existing.client) await existing.client.logout().catch(() => { /* ignore */ });
    idleMap.delete(accountId);
  }
  await startIdleForAccount(accountId);
}

/* ───────────────────────── 내부 구현 ───────────────────────── */

async function startIdleForAccount(accountId: string): Promise<void> {
  const acc = await prisma.mailAccount.findUnique({
    where: { id: accountId },
    select: { id: true, userId: true, email: true, imapHost: true, imapPort: true, encryptedPassword: true, isActive: true },
  });
  if (!acc || !acc.isActive) return;

  const entry: IdleEntry = idleMap.get(accountId) ?? {
    userId: acc.userId,
    accountId: acc.id,
    email: acc.email,
    client: null,
    reconnectTimer: null,
    backoffMs: INITIAL_BACKOFF_MS,
    lastUid: 0,
    stopped: false,
  };
  idleMap.set(accountId, entry);

  let password: string;
  try {
    password = decryptMailPassword(acc.encryptedPassword);
  } catch (err) {
    logger.warn({ accountId, err: (err as Error).message }, '[mail-idle] decrypt failed — skipping');
    return;
  }

  const client = new ImapFlow({
    host: acc.imapHost,
    port: acc.imapPort,
    secure: true,
    auth: { user: acc.email, pass: password },
    logger: false,
    // IDLE 재발행 주기 (imapflow 기본 28분)
  });

  entry.client = client;

  // 에러/종료 시 재연결
  client.on('error', (err) => {
    logger.warn({ accountId, err: err.message }, '[mail-idle] client error');
    emitIdleStatus(acc.userId, 'error', err.message);
    scheduleReconnect(accountId);
  });
  client.on('close', () => {
    if (!entry.stopped) scheduleReconnect(accountId);
  });

  // 새 메일 감지 — exists 이벤트
  client.on('exists', async (data) => {
    try {
      await onExists(entry, data.count);
    } catch (err) {
      logger.warn({ accountId, err: (err as Error).message }, '[mail-idle] exists handler error');
    }
  });

  // 삭제 감지 — expunge 이벤트
  client.on('expunge', (data) => {
    // expunge는 sequence 번호만 줌 — UID 매핑은 어려우므로 프론트에 리프레시 힌트만
    emitMailExpunge(acc.userId, String(data.seq ?? ''), 'INBOX');
  });

  // flag 변경 감지 (seen/flagged)
  client.on('flags', (data) => {
    if (data.uid) {
      emitMailFlags(acc.userId, String(data.uid), 'INBOX', {
        seen: data.flags?.has('\\Seen'),
        flagged: data.flags?.has('\\Flagged'),
      });
    }
  });

  try {
    await client.connect();
    // INBOX 열고 현재 최대 UID 기록 (이후 exists 이벤트의 새 UID 판단용)
    await client.mailboxOpen('INBOX');
    const mbox = client.mailbox as MailboxObject;
    entry.lastUid = mbox.uidNext ? mbox.uidNext - 1 : 0;

    // IDLE 시작 (imapflow는 mailboxOpen 후 자동으로 IDLE 유지)
    entry.backoffMs = INITIAL_BACKOFF_MS; // 재연결 성공
    emitIdleStatus(acc.userId, 'connected');
    logger.info({ accountId, email: acc.email, lastUid: entry.lastUid }, '[mail-idle] IDLE started');
  } catch (err) {
    logger.warn({ accountId, err: (err as Error).message }, '[mail-idle] connect failed');
    emitIdleStatus(acc.userId, 'error', (err as Error).message);
    scheduleReconnect(accountId);
  }
}

async function onExists(entry: IdleEntry, newCount: number): Promise<void> {
  const client = entry.client;
  if (!client || !client.usable) return;

  // 새로 도착한 메시지의 UID를 가져온다 (lastUid + 1 ~ 현재 최대)
  const since = entry.lastUid + 1;
  try {
    // UID로 최근 메시지 envelope 가져오기
    const messages: Array<{
      uid: number; subject: string; from: { address?: string; name?: string } | undefined;
      date: Date | undefined; hasAttachment: boolean;
    }> = [];

    for await (const msg of client.fetch({ uid: `${since}:*` }, {
      envelope: true,
      bodyStructure: true,
      uid: true,
    }, { uid: true })) {
      if (msg.uid > entry.lastUid) entry.lastUid = msg.uid;
      messages.push({
        uid: msg.uid,
        subject: msg.envelope?.subject || '(제목 없음)',
        from: msg.envelope?.from?.[0],
        date: msg.envelope?.date,
        hasAttachment: detectAttachment(msg.bodyStructure),
      });
    }

    if (messages.length === 0) {
      // exists 카운트만 변경된 경우 (expunge 후 재동기화 등) — lastUid를 최신으로 갱신
      const mbox = client.mailbox as MailboxObject;
      if (mbox.uidNext) entry.lastUid = mbox.uidNext - 1;
      return;
    }

    logger.info({ accountId: entry.accountId, count: messages.length }, '[mail-idle] New messages');

    // 메시지당 socket 이벤트 + DB 캐시 추가
    for (const m of messages) {
      emitMailNew(entry.userId, {
        uid: String(m.uid),
        subject: m.subject,
        fromEmail: m.from?.address || '',
        fromName: m.from?.name || undefined,
        sentAt: (m.date || new Date()).toISOString(),
        hasAttachment: m.hasAttachment,
        folder: 'INBOX',
      });
    }

    // 캐시 upsert (백그라운드, 에러 무시)
    Promise.allSettled(
      messages.map((m) =>
        prisma.mailMessageCache.upsert({
          where: {
            accountId_folder_uid: {
              accountId: entry.accountId,
              folder: 'INBOX',
              uid: BigInt(m.uid),
            },
          },
          update: { cachedAt: new Date() },
          create: {
            accountId: entry.accountId,
            uid: BigInt(m.uid),
            folder: 'INBOX',
            messageId: `idle-${m.uid}`,
            subject: m.subject,
            fromEmail: m.from?.address || '',
            fromName: m.from?.name || null,
            toJson: [] as any,
            sentAt: m.date || new Date(),
            hasAttachment: m.hasAttachment,
            size: 0,
          },
        }),
      ),
    );
  } catch (err) {
    logger.warn({ accountId: entry.accountId, err: (err as Error).message }, '[mail-idle] fetch new failed');
  }
  void newCount;
}

function scheduleReconnect(accountId: string): void {
  const entry = idleMap.get(accountId);
  if (!entry || entry.stopped) return;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);

  const delay = Math.min(entry.backoffMs, MAX_BACKOFF_MS);
  logger.info({ accountId, delayMs: delay }, '[mail-idle] Scheduling reconnect');
  entry.reconnectTimer = setTimeout(() => {
    entry.backoffMs = Math.min(entry.backoffMs * 2, MAX_BACKOFF_MS);
    startIdleForAccount(accountId).catch(() => { /* 재연결 실패도 scheduleReconnect로 재귀 */ });
  }, delay);
}

function detectAttachment(bs: unknown): boolean {
  if (!bs || typeof bs !== 'object') return false;
  const b = bs as { disposition?: string; childNodes?: unknown[] };
  if (b.disposition && /attachment/i.test(b.disposition)) return true;
  if (b.childNodes && Array.isArray(b.childNodes)) {
    return b.childNodes.some((c) => detectAttachment(c));
  }
  return false;
}
