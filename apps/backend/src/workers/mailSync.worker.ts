/**
 * 메일 헤더 동기화 워커
 *
 * 5분마다 각 MailAccount의 INBOX에서 최근 UID들을 가져와
 * mail_message_cache에 upsert한다. 본문은 저장하지 않고 헤더만.
 *
 * 목적: 사용자가 메일함 탭 처음 열 때 즉시 목록 표시 (IMAP 왕복 기다리지 않음).
 */
import cron from 'node-cron';
import { ImapFlow, type MailboxObject } from 'imapflow';
import prisma from '../config/prisma';
import { logger } from '../config/logger';
import { decryptMailPassword } from '../utils/mailCrypto';

const SYNC_INTERVAL_SEC = parseInt(process.env.MAIL_SYNC_INTERVAL_SEC || '300', 10);
const MESSAGES_PER_FOLDER = 50;  // 폴더당 최신 N개 캐시
const FOLDERS_TO_SYNC = ['INBOX', 'Sent'];

let isRunning = false;
let scheduled: cron.ScheduledTask | null = null;

export async function runMailSyncOnce(): Promise<{ accounts: number; messages: number; errors: number }> {
  if (isRunning) {
    logger.debug('Mail sync already running — skip');
    return { accounts: 0, messages: 0, errors: 0 };
  }
  isRunning = true;

  const start = Date.now();
  const accounts = await prisma.mailAccount.findMany({ where: { isActive: true } });
  let totalMessages = 0;
  let errors = 0;

  for (const acc of accounts) {
    try {
      const pw = decryptMailPassword(acc.encryptedPassword);
      const client = new ImapFlow({
        host: acc.imapHost,
        port: acc.imapPort,
        secure: true,
        auth: { user: acc.email, pass: pw },
        logger: false,
      });

      await client.connect();
      try {
        for (const folder of FOLDERS_TO_SYNC) {
          const synced = await syncFolder(client, acc.id, folder);
          totalMessages += synced;
        }
      } finally {
        await client.logout().catch(() => { /* ignore */ });
      }

      await prisma.mailAccount.update({
        where: { id: acc.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      errors++;
      const msg = (err as Error).message.slice(0, 500);
      await prisma.mailAccount.update({
        where: { id: acc.id },
        data: { lastSyncError: msg, lastSyncAt: new Date() },
      }).catch(() => { /* ignore */ });
      logger.warn({ accountId: acc.id, email: acc.email, err: msg }, 'Mail sync account failed');
    }
  }

  const duration = Date.now() - start;
  logger.info(
    { accounts: accounts.length, messages: totalMessages, errors, durationMs: duration },
    'Mail sync complete',
  );

  isRunning = false;
  return { accounts: accounts.length, messages: totalMessages, errors };
}

async function syncFolder(client: ImapFlow, accountId: string, folder: string): Promise<number> {
  let lock;
  try {
    lock = await client.getMailboxLock(folder);
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    return 0; // 폴더 없으면 스킵
  }

  try {
    const mbox = client.mailbox as MailboxObject;
    if (mbox.exists === 0) return 0;

    // 최신 N개
    const from = Math.max(1, mbox.exists - MESSAGES_PER_FOLDER + 1);
    const seq = `${from}:${mbox.exists}`;

    let count = 0;
    const ops: Array<Promise<unknown>> = [];

    for await (const msg of client.fetch(seq, {
      envelope: true,
      flags: true,
      size: true,
      uid: true,
      bodyStructure: true,
    })) {
      const env = msg.envelope;
      const from = env?.from?.[0];
      const flagsSet = msg.flags ?? new Set<string>();
      const hasAttachment = detectAttachmentFromBodyStructure(msg.bodyStructure);

      const op = prisma.mailMessageCache.upsert({
        where: {
          accountId_folder_uid: {
            accountId,
            folder,
            uid: BigInt(msg.uid),
          },
        },
        create: {
          accountId,
          uid: BigInt(msg.uid),
          folder,
          messageId: env?.messageId || `nomsgid-${msg.uid}`,
          subject: env?.subject || null,
          fromEmail: from?.address || '',
          fromName: from?.name || null,
          toJson: (env?.to ?? []).map((a) => ({ email: a.address, name: a.name })) as any,
          ccJson: env?.cc?.map((a) => ({ email: a.address, name: a.name })) as any ?? undefined,
          sentAt: env?.date || new Date(),
          isSeen: flagsSet.has('\\Seen'),
          isFlagged: flagsSet.has('\\Flagged'),
          hasAttachment,
          size: msg.size ?? 0,
        },
        update: {
          isSeen: flagsSet.has('\\Seen'),
          isFlagged: flagsSet.has('\\Flagged'),
          cachedAt: new Date(),
        },
      });
      ops.push(op);
      count++;
    }

    await Promise.allSettled(ops);
    return count;
  } finally {
    lock.release();
  }
}

function detectAttachmentFromBodyStructure(bs: unknown): boolean {
  if (!bs || typeof bs !== 'object') return false;
  const b = bs as { disposition?: string; childNodes?: unknown[] };
  if (b.disposition && /attachment/i.test(b.disposition)) return true;
  if (b.childNodes && Array.isArray(b.childNodes)) {
    return b.childNodes.some((c) => detectAttachmentFromBodyStructure(c));
  }
  return false;
}

/**
 * 서버 시작 시 호출. 5분(또는 지정된 주기)마다 runMailSyncOnce 실행.
 */
export function startMailSyncScheduler(): void {
  if (scheduled) return;

  const cronExpr = intervalSecToCron(SYNC_INTERVAL_SEC);
  scheduled = cron.schedule(cronExpr, () => {
    runMailSyncOnce().catch((err) => {
      logger.error({ err: (err as Error).message }, 'Mail sync scheduler error');
    });
  });

  logger.info({ cron: cronExpr, intervalSec: SYNC_INTERVAL_SEC }, 'Mail sync scheduler started');
}

export function stopMailSyncScheduler(): void {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
  }
}

function intervalSecToCron(sec: number): string {
  // 300 → "*/5 * * * *"
  if (sec % 60 === 0) {
    const min = sec / 60;
    return `*/${min} * * * *`;
  }
  // fallback: 매 sec 초마다 (node-cron은 초 단위는 6-field 표현)
  return `*/${sec} * * * * *`;
}
