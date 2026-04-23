/**
 * 시스템 이메일 발송 — 초대 / 비밀번호 재설정 / 기타 시스템 공지
 *
 * 일반 사용자의 AWS WorkMail 메일(mail.service.ts)과 달리,
 * **회사 공통 no-reply 주소**에서 발송한다.
 *
 * 환경변수 SYSTEM_MAIL_SMTP_HOST 등 미설정 시 실제 발송은 스킵되고
 * 콘솔에 "[system-mail] email skipped" 로그만 남아 개발/테스트에서 안전.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '../config/logger';
import { config } from '../config';

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.systemMail.enabled) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: config.systemMail.host,
      port: config.systemMail.port,
      secure: config.systemMail.port === 465,
      auth: { user: config.systemMail.user, pass: config.systemMail.pass },
    });
  }
  return _transporter;
}

export interface SendMailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export async function sendSystemMail(input: SendMailInput): Promise<{ sent: boolean; reason?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn(
      { to: input.to, subject: input.subject },
      '[system-mail] SMTP not configured — email skipped (dev mode)',
    );
    return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    const info = await transporter.sendMail({
      from: config.systemMail.from,
      to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
      subject: input.subject,
      text: input.text || stripHtml(input.html),
      html: input.html,
    });
    logger.info({ to: input.to, messageId: info.messageId, subject: input.subject }, '[system-mail] sent');
    return { sent: true };
  } catch (e) {
    logger.error({ err: (e as Error).message, to: input.to }, '[system-mail] send failed');
    return { sent: false, reason: (e as Error).message };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ── 템플릿 ──

function baseLayout(title: string, body: string, ctaLabel?: string, ctaUrl?: string): string {
  return `
<!doctype html>
<html lang="ko">
  <body style="margin:0;padding:0;background:#f5f7f0;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;">
    <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.05);">
      <div style="background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);padding:28px;color:#fff;">
        <div style="font-size:14px;opacity:0.9;">Project Office</div>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;">${escapeHtml(title)}</h1>
      </div>
      <div style="padding:28px;color:#1f2937;line-height:1.6;font-size:15px;">
        ${body}
        ${
          ctaLabel && ctaUrl
            ? `<div style="margin-top:28px;text-align:center;">
                 <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(ctaLabel)}</a>
               </div>
               <div style="margin-top:16px;font-size:12px;color:#6b7280;word-break:break-all;">
                 버튼이 작동하지 않으면 다음 링크를 복사하세요:<br/>
                 <a href="${escapeHtml(ctaUrl)}" style="color:#16a34a;">${escapeHtml(ctaUrl)}</a>
               </div>`
            : ''
        }
      </div>
      <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;">
        이 메일은 자동으로 발송되었습니다. 회신하지 마세요.<br/>
        문제가 있다면 관리자에게 문의해주세요.
      </div>
    </div>
  </body>
</html>`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
}

/**
 * 초대 메일
 */
export async function sendInviteEmail(opts: {
  to: string;
  inviteeName: string;
  inviterName: string;
  token: string;
  expiresAt: Date;
}): Promise<{ sent: boolean; reason?: string }> {
  const link = `${config.systemMail.webUrl}/invite/${opts.token}`;
  const expiresStr = opts.expiresAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const body = `
    <p>${escapeHtml(opts.inviteeName)}님, 안녕하세요.</p>
    <p><strong>${escapeHtml(opts.inviterName)}</strong>님께서 Project Office 계정을 초대했습니다.</p>
    <p>아래 버튼을 클릭해 비밀번호를 설정하고 계정을 활성화하세요.</p>
    <p style="color:#ef4444;font-size:13px;">이 링크는 <strong>${escapeHtml(expiresStr)}</strong>까지 유효하며, 한 번만 사용할 수 있습니다.</p>
  `;
  return sendSystemMail({
    to: opts.to,
    subject: '[Project Office] 계정 초대가 도착했습니다',
    html: baseLayout('계정 초대', body, '비밀번호 설정하기', link),
  });
}

/**
 * 비밀번호 재설정 메일
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  userName: string;
  token: string;
  expiresAt: Date;
}): Promise<{ sent: boolean; reason?: string }> {
  const link = `${config.systemMail.webUrl}/reset-password/${opts.token}`;
  const expiresStr = opts.expiresAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const body = `
    <p>${escapeHtml(opts.userName)}님, 안녕하세요.</p>
    <p>비밀번호 재설정 요청을 받았습니다.</p>
    <p>아래 버튼을 클릭해 새 비밀번호를 설정하세요.</p>
    <p style="color:#ef4444;font-size:13px;">이 링크는 <strong>${escapeHtml(expiresStr)}</strong>까지 유효하며, 한 번만 사용할 수 있습니다.</p>
    <p style="color:#6b7280;font-size:13px;">본인이 요청하지 않았다면 이 메일을 무시하고 비밀번호를 그대로 사용하세요.</p>
  `;
  return sendSystemMail({
    to: opts.to,
    subject: '[Project Office] 비밀번호 재설정 안내',
    html: baseLayout('비밀번호 재설정', body, '새 비밀번호 설정하기', link),
  });
}
