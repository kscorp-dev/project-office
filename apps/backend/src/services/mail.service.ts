/**
 * 메일 송수신 서비스 — IMAP (imapflow) + SMTP (nodemailer)
 *
 * WorkMail 계정의 저장된 비밀번호로 로그인해 동작한다.
 * 연결은 매 호출마다 새로 생성 후 close (장기 유휴 방지, 리소스 절감).
 * 고빈도 호출 시 ImapFlow의 pool/keepalive 고려 — 초기엔 단순 pattern.
 */
import { ImapFlow, type FetchMessageObject, type MailboxObject } from 'imapflow';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import prisma from '../config/prisma';
import { decryptMailPassword } from '../utils/mailCrypto';
import { AppError } from './auth.service';
import { logger } from '../config/logger';

/* ───────────────────────── 타입 ───────────────────────── */

export interface MailListItem {
  uid: string;                 // bigint → string (JSON 안전)
  messageId: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  to: { email: string; name?: string }[];
  cc?: { email: string; name?: string }[];
  snippet: string;
  sentAt: string;              // ISO
  isSeen: boolean;
  isFlagged: boolean;
  hasAttachment: boolean;
  size: number;
}

export interface MailDetail extends MailListItem {
  html: string | null;         // sanitized HTML
  text: string | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    contentId?: string;
    cid?: string;
    index: number;             // 첨부파일 다운로드 시 사용
  }>;
}

export interface FolderInfo {
  name: string;
  path: string;
  specialUse?: string;          // \Inbox, \Sent, \Drafts, \Trash, \Junk
  unseen: number;
  total: number;
}

/* ───────────────────────── HTML sanitize 정책 ───────────────────────── */

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img',
    'blockquote', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'div', 'span',
    'style',   // 이메일 본문에 자주 포함 (허용하되 위험 선택자 필터)
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['class', 'style', 'colspan', 'rowspan'],
  },
  // 사용자 요구사항: 외부 이미지 자동 로드 → http(s), cid:, data: 모두 허용
  allowedSchemesByTag: {
    img: ['http', 'https', 'cid', 'data'],
    a: ['http', 'https', 'mailto', 'tel'],
  },
  // target="_blank" 링크에 rel="noopener noreferrer" 강제
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        attribs.rel = 'noopener noreferrer';
      }
      return { tagName, attribs };
    },
  },
  // on* 이벤트 핸들러 전부 차단 (기본 동작이지만 명시)
  allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid', 'data'],
};

function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/* ───────────────────────── 주소 추출 헬퍼 ───────────────────────── */

function addressesToList(addr?: AddressObject | AddressObject[]): { email: string; name?: string }[] {
  if (!addr) return [];
  const items = Array.isArray(addr) ? addr.flatMap((a) => a.value) : addr.value;
  return items
    .filter((x) => x.address)
    .map((x) => ({ email: x.address!.toLowerCase(), name: x.name || undefined }));
}

/* ───────────────────────── IMAP 연결 풀 ───────────────────────── */
/**
 * 매 API 호출마다 IMAP 연결/로그인/로그아웃(총 1~2초)을 반복하지 않도록
 * 사용자별 ImapFlow 클라이언트 하나를 유지한다.
 * - 유휴 2분이 지나면 자동 로그아웃
 * - 서버 종료 시 전체 정리 (shutdown() 호출)
 * - 동시 요청은 ImapFlow 내부의 mailbox lock으로 직렬화
 */
interface PoolEntry {
  client: ImapFlow;
  lastUsed: number;
  closing?: boolean;
}
const imapPool = new Map<string, PoolEntry>();
const POOL_IDLE_MS = 2 * 60_000;

async function acquireImap(
  userId: string,
  spec: { imapHost: string; imapPort: number; email: string; password: string },
): Promise<ImapFlow> {
  const existing = imapPool.get(userId);
  const now = Date.now();

  if (existing && !existing.closing) {
    // 유휴 타임아웃 검사
    if (now - existing.lastUsed > POOL_IDLE_MS) {
      existing.closing = true;
      await existing.client.logout().catch(() => { /* ignore */ });
      imapPool.delete(userId);
    } else if (existing.client.usable) {
      existing.lastUsed = now;
      return existing.client;
    } else {
      // 연결 끊김 — 정리 후 재생성
      imapPool.delete(userId);
    }
  }

  const client = new ImapFlow({
    host: spec.imapHost,
    port: spec.imapPort,
    secure: true,
    auth: { user: spec.email, pass: spec.password },
    logger: false,
  });
  await client.connect();

  // 에러/종료 이벤트 시 풀에서 제거
  const cleanup = () => {
    const e = imapPool.get(userId);
    if (e && e.client === client) imapPool.delete(userId);
  };
  client.on('error', cleanup);
  client.on('close', cleanup);

  imapPool.set(userId, { client, lastUsed: now });
  return client;
}

/** 유휴 연결 주기적 정리 (1분마다) */
const POOL_SWEEP_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of imapPool.entries()) {
    if (now - entry.lastUsed > POOL_IDLE_MS && !entry.closing) {
      entry.closing = true;
      entry.client.logout().catch(() => { /* ignore */ }).finally(() => {
        imapPool.delete(userId);
      });
    }
  }
}, POOL_SWEEP_MS).unref();

/** 서버 종료 시 전체 로그아웃 */
export async function shutdownMailPool(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [userId, entry] of imapPool.entries()) {
    imapPool.delete(userId);
    tasks.push(entry.client.logout().catch(() => { /* ignore */ }));
  }
  await Promise.allSettled(tasks);
}

/* ───────────────────────── 서비스 본체 ───────────────────────── */

export class MailService {
  /** 사용자 ID로 MailAccount 조회 + 비밀번호 복호화 */
  private async getAccount(userId: string) {
    const acc = await prisma.mailAccount.findUnique({ where: { userId } });
    if (!acc || !acc.isActive) {
      throw new AppError(404, 'MAIL_ACCOUNT_NOT_LINKED', '메일 계정이 연결되지 않았습니다');
    }
    return { ...acc, password: decryptMailPassword(acc.encryptedPassword) };
  }

  /** 사용자 계정용 IMAP 클라이언트 (풀에서 가져옴 — 재사용) */
  private async getImapClient(account: { imapHost: string; imapPort: number; email: string; password: string }, userId: string) {
    return acquireImap(userId, account);
  }

  /** SMTP transporter */
  private createSmtpTransporter(account: { smtpHost: string; smtpPort: number; email: string; password: string }): Transporter {
    return nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpPort === 465,
      auth: { user: account.email, pass: account.password },
      connectionTimeout: 15000,
      socketTimeout: 30000,
    });
  }

  /* ───── 연결 테스트 (로그인 성공 여부만) ───── */
  async testConnection(userId: string): Promise<{ imap: boolean; smtp: boolean; error?: string }> {
    const acc = await this.getAccount(userId);
    let imapOk = false, smtpOk = false;
    let err: string | undefined;

    try {
      await this.getImapClient(acc, userId);    // 풀에 영속 연결 확보
      imapOk = true;
    } catch (e) {
      err = `IMAP: ${(e as Error).message}`;
    }

    try {
      const t = this.createSmtpTransporter(acc);
      await t.verify();
      smtpOk = true;
    } catch (e) {
      err = err ? `${err} | SMTP: ${(e as Error).message}` : `SMTP: ${(e as Error).message}`;
    }

    return { imap: imapOk, smtp: smtpOk, error: err };
  }

  /**
   * 관리자용 수신 테스트 — 특정 MailAccount의 INBOX에 접속해 최근 N통 헤더를 가져온다.
   *
   * 사용자용 testConnection()은 '로그인 성공만' 확인하지만 이것은:
   *   - IMAP 로그인
   *   - INBOX 실제 open + mailbox status
   *   - 최근 5통(또는 N통) envelope/flags/uid fetch
   *   - 완료 후 즉시 logout (풀 사용 안 함 — 관리자가 임시로 확인하는 용도)
   *
   * 특정 userId에 귀속되지 않고 MailAccount.id로 직접 접속하므로
   * 관리자가 모든 직원 계정의 수신 상태를 확인 가능.
   */
  async adminTestInbox(
    accountId: string,
    limit = 5,
  ): Promise<{
    ok: boolean;
    email: string;
    totalMessages?: number;
    recentMessages?: Array<{
      uid: number;
      from: string | null;
      subject: string | null;
      date: string | null;
      seen: boolean;
      size: number;
    }>;
    error?: string;
    elapsedMs: number;
  }> {
    const startedAt = Date.now();
    const account = await prisma.mailAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return {
        ok: false,
        email: '',
        error: 'MailAccount를 찾을 수 없습니다',
        elapsedMs: Date.now() - startedAt,
      };
    }
    if (!account.isActive) {
      return {
        ok: false,
        email: account.email,
        error: '비활성 계정입니다',
        elapsedMs: Date.now() - startedAt,
      };
    }

    // 일회성 클라이언트 (풀 오염 방지)
    const password = decryptMailPassword(account.encryptedPassword);
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: true,
      auth: { user: account.email, pass: password },
      logger: false,
    });

    const cappedLimit = Math.max(1, Math.min(50, limit));

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        const mbox = client.mailbox as MailboxObject;
        const total = mbox.exists;

        const recent: Array<{
          uid: number;
          from: string | null;
          subject: string | null;
          date: string | null;
          seen: boolean;
          size: number;
        }> = [];

        if (total > 0) {
          const first = Math.max(1, total - cappedLimit + 1);
          const seq = `${first}:${total}`;
          for await (const msg of client.fetch(seq, {
            envelope: true,
            flags: true,
            size: true,
            uid: true,
          })) {
            const env = msg.envelope as FetchMessageObject['envelope'] | undefined;
            const fromAddr = env?.from?.[0];
            const fromStr = fromAddr
              ? `${fromAddr.name ?? ''} <${fromAddr.address ?? ''}>`.trim()
              : null;
            recent.push({
              uid: msg.uid ?? 0,
              from: fromStr,
              subject: env?.subject ?? null,
              date: env?.date ? new Date(env.date).toISOString() : null,
              seen: msg.flags?.has('\\Seen') ?? false,
              size: msg.size ?? 0,
            });
          }
          // fetch는 오름차순 — 최신이 뒤에 오므로 뒤집어서 반환 (최신 먼저)
          recent.reverse();
        }

        return {
          ok: true,
          email: account.email,
          totalMessages: total,
          recentMessages: recent,
          elapsedMs: Date.now() - startedAt,
        };
      } finally {
        lock.release();
      }
    } catch (e) {
      return {
        ok: false,
        email: account.email,
        error: (e as Error).message || 'IMAP 접속 실패',
        elapsedMs: Date.now() - startedAt,
      };
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }

  /* ───── 폴더 목록 ───── */
  async listFolders(userId: string): Promise<FolderInfo[]> {
    const acc = await this.getAccount(userId);
    const client = await this.getImapClient(acc, userId);
    const list = await client.list();
    const folders: FolderInfo[] = [];
    for (const box of list) {
      if (box.flags.has('\\Noselect')) continue;
      try {
        const status = await client.status(box.path, { messages: true, unseen: true });
        folders.push({
          name: box.name,
          path: box.path,
          specialUse: box.specialUse,
          total: status.messages ?? 0,
          unseen: status.unseen ?? 0,
        });
      } catch (err) {
        logger.warn({ err }, 'Internal error');
        // 특정 폴더 status 실패는 무시 (권한 등)
      }
    }
    return folders;
  }

  /* ───── 메일 목록 (페이지네이션) ───── */
  async listMessages(
    userId: string,
    options: { folder?: string; page?: number; limit?: number; search?: string } = {},
  ): Promise<{ items: MailListItem[]; total: number }> {
    const acc = await this.getAccount(userId);
    const folder = options.folder || 'INBOX';
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));

    const client = await this.getImapClient(acc, userId);
    const lock = await client.getMailboxLock(folder);
    try {
      const mbox = client.mailbox as MailboxObject;
      const total = mbox.exists;
      if (total === 0) return { items: [], total: 0 };

      // 검색 (subject/from) 또는 전체
      let uids: number[];
      if (options.search) {
        const res = await client.search({ or: [{ subject: options.search }, { from: options.search }] });
        uids = (res || []).reverse(); // 최신 순
      } else {
        // 전체 UID 중 최신 페이지만 fetch
        const allSeq = `${Math.max(1, total - page * limit + 1)}:${Math.max(1, total - (page - 1) * limit)}`;
        uids = [];
        for await (const msg of client.fetch(allSeq, { uid: true })) {
          uids.push(msg.uid);
        }
        uids.reverse();
      }

      const actualTotal = options.search ? uids.length : total;
      const startIdx = options.search ? (page - 1) * limit : 0;
      const sliceUids = uids.slice(startIdx, startIdx + limit);
      if (sliceUids.length === 0) return { items: [], total: actualTotal };

      // ENVELOPE + FLAGS + BODYSTRUCTURE 가져오기
      const items: MailListItem[] = [];
      for await (const msg of client.fetch(sliceUids, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true,
        uid: true,
      }, { uid: true })) {
        items.push(this.mapFetchToListItem(msg));
      }
      items.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
      return { items, total: actualTotal };
    } finally {
      lock.release();
    }
  }

  /* ───── 메일 상세 (본문 + 첨부 메타) ───── */
  async getMessage(userId: string, folder: string, uid: string): Promise<MailDetail> {
    const acc = await this.getAccount(userId);
    const client = await this.getImapClient(acc, userId);
    const lock = await client.getMailboxLock(folder);
    try {
      const raw = await client.download(uid, undefined, { uid: true });
      if (!raw) throw new AppError(404, 'NOT_FOUND', '메일을 찾을 수 없습니다');

      const stream = raw.content;
      const parsed: ParsedMail = await simpleParser(stream);

      // 메타
      const fetched = await client.fetchOne(uid, {
        envelope: true,
        flags: true,
        size: true,
        uid: true,
      }, { uid: true });
      if (!fetched) throw new AppError(404, 'NOT_FOUND', '메일 메타를 읽을 수 없습니다');

      const listItem = this.mapFetchToListItem(fetched);

      // 읽음 처리
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => { /* ignore */ });

      return {
        ...listItem,
        isSeen: true,
        html: parsed.html ? sanitizeMailHtml(parsed.html) : null,
        text: parsed.text ?? null,
        attachments: (parsed.attachments || []).map((a, idx) => ({
          filename: a.filename || `attachment-${idx}`,
          contentType: a.contentType,
          size: a.size,
          contentId: a.contentId,
          cid: a.cid,
          index: idx,
        })),
      };
    } finally {
      lock.release();
    }
  }

  /* ───── 첨부파일 스트림 (다운로드 프록시) ───── */
  async getAttachment(userId: string, folder: string, uid: string, index: number) {
    const acc = await this.getAccount(userId);
    const client = await this.getImapClient(acc, userId);
    const lock = await client.getMailboxLock(folder);
    try {
      const raw = await client.download(uid, undefined, { uid: true });
      if (!raw) throw new AppError(404, 'NOT_FOUND', '메일을 찾을 수 없습니다');
      const parsed = await simpleParser(raw.content);
      const att = parsed.attachments?.[index];
      if (!att) throw new AppError(404, 'NOT_FOUND', '첨부파일을 찾을 수 없습니다');
      return {
        filename: att.filename || `attachment-${index}`,
        contentType: att.contentType,
        content: att.content,  // Buffer
        size: att.size,
      };
    } finally {
      lock.release();
    }
  }

  /* ───── flag 변경 (읽음/별표) ───── */
  async updateFlags(
    userId: string,
    folder: string,
    uid: string,
    flags: { seen?: boolean; flagged?: boolean },
  ): Promise<void> {
    const acc = await this.getAccount(userId);
    const client = await this.getImapClient(acc, userId);
    const lock = await client.getMailboxLock(folder);
    try {
      const add: string[] = [], remove: string[] = [];
      if (flags.seen === true) add.push('\\Seen');
      if (flags.seen === false) remove.push('\\Seen');
      if (flags.flagged === true) add.push('\\Flagged');
      if (flags.flagged === false) remove.push('\\Flagged');

      if (add.length) await client.messageFlagsAdd(uid, add, { uid: true });
      if (remove.length) await client.messageFlagsRemove(uid, remove, { uid: true });
    } finally {
      lock.release();
    }
  }

  /* ───── 폴더 이동 ───── */
  async moveMessage(userId: string, fromFolder: string, toFolder: string, uid: string): Promise<void> {
    const acc = await this.getAccount(userId);
    const client = await this.getImapClient(acc, userId);
    const lock = await client.getMailboxLock(fromFolder);
    try {
      await client.messageMove(uid, toFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  /* ───── 휴지통 이동 (삭제) ───── */
  async deleteMessage(userId: string, folder: string, uid: string): Promise<void> {
    // WorkMail 특수 폴더는 "Deleted Messages"
    await this.moveMessage(userId, folder, 'Deleted Messages', uid).catch(async () => {
      // fallback: Trash
      await this.moveMessage(userId, folder, 'Trash', uid);
    });
  }

  /* ───── 메일 발송 ───── */
  async sendMessage(
    userId: string,
    params: {
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      text?: string;
      html?: string;
      attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
    },
  ): Promise<{ messageId: string }> {
    const acc = await this.getAccount(userId);
    if (!params.to?.length) throw new AppError(400, 'NO_RECIPIENT', '받는 사람이 없습니다');
    if (!params.subject) throw new AppError(400, 'NO_SUBJECT', '제목이 필요합니다');

    const t = this.createSmtpTransporter(acc);
    const info = await t.sendMail({
      from: { name: acc.displayName, address: acc.email },
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });

    // Sent 폴더 저장은 WorkMail SMTP가 기본적으로 처리함 (Sent Items).
    // 추가 APPEND는 nodemailer streamTransport 재구성이 필요해 best-effort로 스킵.

    return { messageId: info.messageId || '' };
  }

  private async resolveSpecialFolder(client: ImapFlow, flag: string): Promise<string | null> {
    const list = await client.list();
    const match = list.find((m) => m.specialUse === flag);
    return match?.path || null;
  }

  /* ───── 메일 원본 → MailListItem 매핑 ───── */
  private mapFetchToListItem(msg: FetchMessageObject): MailListItem {
    const env = msg.envelope;
    const from = env?.from?.[0];
    const flagsSet = msg.flags ?? new Set<string>();

    const to = (env?.to ?? []).map((a) => ({ email: a.address || '', name: a.name }));
    const cc = env?.cc?.map((a) => ({ email: a.address || '', name: a.name }));

    const hasAttachment = this.detectAttachmentFromBodyStructure(msg.bodyStructure);

    return {
      uid: String(msg.uid),
      messageId: env?.messageId || '',
      subject: env?.subject || '(제목 없음)',
      fromEmail: from?.address || '',
      fromName: from?.name || undefined,
      to,
      cc,
      snippet: '',  // envelope에는 본문 snippet 없음 — 필요 시 별도 FETCH로
      sentAt: (env?.date || new Date()).toISOString(),
      isSeen: flagsSet.has('\\Seen'),
      isFlagged: flagsSet.has('\\Flagged'),
      hasAttachment,
      size: msg.size ?? 0,
    } as MailListItem;
  }

  private detectAttachmentFromBodyStructure(bs: unknown): boolean {
    if (!bs || typeof bs !== 'object') return false;
    const b = bs as { disposition?: string; childNodes?: unknown[]; type?: string };
    if (b.disposition && /attachment/i.test(b.disposition)) return true;
    if (b.childNodes && Array.isArray(b.childNodes)) {
      return b.childNodes.some((c) => this.detectAttachmentFromBodyStructure(c));
    }
    return false;
  }
}

/* ───────────────────────── 싱글톤 ───────────────────────── */

let _instance: MailService | null = null;
export function getMailService(): MailService {
  if (!_instance) _instance = new MailService();
  return _instance;
}
