/**
 * Google Calendar 양방향 동기화 서비스 (v0.18.0 Phase 2)
 *
 * OAuth2 flow:
 *   1. getAuthorizationUrl — 동의 화면 URL 생성
 *   2. handleOAuthCallback — code 받아서 token 저장 + CalendarExternalSync upsert
 *   3. refreshAccessTokenIfNeeded — 만료 60초 전 자동 재발급
 *
 * Push (Project Office → Google):
 *   - pushEventToGoogle / updateEventOnGoogle / deleteEventOnGoogle
 *   - 로컬 CalendarEvent 변경 시 트리거
 *   - CalendarEventExternalMap에 매핑 저장 → 중복 방지
 *
 * Pull (Google → Project Office): — 수동 "지금 동기화" 버튼
 *   - pullEventsFromGoogle(userId)
 *   - events.list(syncToken=...) 증분 동기화
 *   - 로컬에 없는 외부 이벤트는 CalendarEvent 생성 (creatorId=사용자)
 *   - 수정/삭제도 처리
 *
 * 토큰 저장: mailCrypto의 AES-256-GCM 재사용 (별도 키 관리 필요 없음)
 */
import crypto from 'crypto';
import { google, type Auth, type calendar_v3 } from 'googleapis';
import type { CalendarEvent as PoCalendarEvent } from '@prisma/client';
import prisma from '../config/prisma';
import { logger } from '../config/logger';
import { config } from '../config';
import { AppError } from './auth.service';
import { encryptMailPassword, decryptMailPassword } from '../utils/mailCrypto';

// ── OAuth state CSRF 방지 (audit 7차 C2) ──
// 공격자가 본인 Google code + 피해자 userId 를 callback 에 보내면 피해자 계정에
// 본인 토큰이 저장되는 계정 강탈 가능. state 에 HMAC + nonce 적용해 차단.
const usedNonces = new Set<string>();
const STATE_TTL_MS = 10 * 60_000; // 10분
const NONCE_GC_MS = 15 * 60_000; // 15분 후 정리

function signState(userId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload = `${userId}|${nonce}|${expiresAt}`;
  const sig = crypto.createHmac('sha256', config.jwt.accessSecret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifyState(state: string): { ok: true; userId: string } | { ok: false; reason: string } {
  let decoded: string;
  try { decoded = Buffer.from(state, 'base64url').toString('utf8'); }
  catch { return { ok: false, reason: 'INVALID_STATE_FORMAT' }; }
  const parts = decoded.split('|');
  if (parts.length !== 4) return { ok: false, reason: 'INVALID_STATE_PARTS' };
  const [userId, nonce, expiresStr, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', config.jwt.accessSecret)
    .update(`${userId}|${nonce}|${expiresStr}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'STATE_TAMPERED' };
  }
  if (Date.now() > Number(expiresStr)) return { ok: false, reason: 'STATE_EXPIRED' };
  if (usedNonces.has(nonce)) return { ok: false, reason: 'STATE_REPLAY' };
  usedNonces.add(nonce);
  setTimeout(() => usedNonces.delete(nonce), NONCE_GC_MS).unref();
  return { ok: true, userId };
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

// ── OAuth2 클라이언트 헬퍼 ──

function getOAuth2Client(): Auth.OAuth2Client {
  if (!config.google.enabled) {
    throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', '서버에 Google OAuth가 설정되지 않았습니다');
  }
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

/** 동의 화면 URL — state에 HMAC(userId|nonce|expires) 로 CSRF 차단 */
export function getAuthorizationUrl(userId: string): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',  // refresh token 받기 위함
    prompt: 'consent',       // refresh token 재발급 보장
    scope: SCOPES,
    state: signState(userId),
    include_granted_scopes: true,
  });
}

/** code → token 교환 + Google 계정 정보 조회 + DB upsert */
export async function handleOAuthCallback(code: string, signedState: string): Promise<void> {
  const verification = verifyState(signedState);
  if (!verification.ok) {
    throw new AppError(400, 'INVALID_OAUTH_STATE',
      `OAuth state 검증 실패: ${verification.reason}`);
  }
  const userId = verification.userId;
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new AppError(
      400,
      'OAUTH_INCOMPLETE_GRANT',
      'Google이 refresh_token을 돌려주지 않았습니다. 동의 화면에서 "offline" 권한을 수락해야 합니다.',
    );
  }

  oauth2.setCredentials(tokens);

  // Google 계정 email 조회 (식별용)
  const userInfoRes = await google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get();
  const externalAccountId = userInfoRes.data.email || userInfoRes.data.id || 'unknown';

  const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000);

  await prisma.calendarExternalSync.upsert({
    where: { userId },
    update: {
      provider: 'google',
      externalAccountId,
      externalCalendarId: 'primary',
      accessTokenEnc: encryptMailPassword(tokens.access_token),
      refreshTokenEnc: encryptMailPassword(tokens.refresh_token),
      scope: tokens.scope ?? null,
      tokenExpiresAt: expiresAt,
      isActive: true,
      lastSyncError: null,
    },
    create: {
      userId,
      provider: 'google',
      externalAccountId,
      externalCalendarId: 'primary',
      accessTokenEnc: encryptMailPassword(tokens.access_token),
      refreshTokenEnc: encryptMailPassword(tokens.refresh_token),
      scope: tokens.scope ?? null,
      tokenExpiresAt: expiresAt,
    },
  });

  logger.info({ userId, externalAccountId }, '[google-cal] OAuth connected');
}

/** 만료 60초 전이면 refresh + DB 갱신. 인증된 OAuth2Client 반환 */
async function getAuthorizedClient(
  userId: string,
): Promise<{ client: Auth.OAuth2Client; calendarId: string }> {
  const sync = await prisma.calendarExternalSync.findUnique({ where: { userId } });
  if (!sync || !sync.isActive) {
    throw new AppError(400, 'NOT_CONNECTED', 'Google Calendar 연동이 설정되지 않았습니다');
  }

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: decryptMailPassword(sync.accessTokenEnc),
    refresh_token: decryptMailPassword(sync.refreshTokenEnc),
    expiry_date: sync.tokenExpiresAt.getTime(),
  });

  // 60초 마진
  if (sync.tokenExpiresAt.getTime() - Date.now() < 60_000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      if (credentials.access_token) {
        await prisma.calendarExternalSync.update({
          where: { userId },
          data: {
            accessTokenEnc: encryptMailPassword(credentials.access_token),
            tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600 * 1000),
            // refresh_token이 새로 오면 갱신 (Google은 보통 유지)
            ...(credentials.refresh_token
              ? { refreshTokenEnc: encryptMailPassword(credentials.refresh_token) }
              : {}),
          },
        });
        client.setCredentials(credentials);
      }
    } catch (e) {
      logger.error({ err: e, userId }, '[google-cal] refresh failed');
      await prisma.calendarExternalSync.update({
        where: { userId },
        data: { lastSyncError: (e as Error).message, isActive: false },
      });
      throw new AppError(401, 'TOKEN_REFRESH_FAILED', 'Google 토큰 갱신에 실패했습니다. 다시 연동해주세요.');
    }
  }

  return { client, calendarId: sync.externalCalendarId };
}

/** 연동 해제 — 토큰 revoke + DB 레코드 비활성 */
export async function disconnectGoogle(userId: string): Promise<void> {
  const sync = await prisma.calendarExternalSync.findUnique({ where: { userId } });
  if (!sync) return;

  // Google에 revoke 요청 (실패해도 로컬은 해제)
  try {
    const client = getOAuth2Client();
    client.setCredentials({
      refresh_token: decryptMailPassword(sync.refreshTokenEnc),
    });
    await client.revokeCredentials();
  } catch (e) {
    logger.warn({ err: e, userId }, '[google-cal] revoke failed (continuing)');
  }

  // 매핑도 제거
  const eventIds = (
    await prisma.calendarEventExternalMap.findMany({
      where: { provider: 'google' },
      select: { eventId: true },
    })
  ).map((m) => m.eventId);
  if (eventIds.length > 0) {
    await prisma.calendarEventExternalMap.deleteMany({
      where: { eventId: { in: eventIds }, provider: 'google' },
    });
  }

  await prisma.calendarExternalSync.delete({ where: { userId } });
  logger.info({ userId }, '[google-cal] disconnected');
}

// ── Push: 로컬 → Google ──

function toGoogleEvent(e: PoCalendarEvent): calendar_v3.Schema$Event {
  const start = e.allDay
    ? { date: e.startDate.toISOString().slice(0, 10) }
    : { dateTime: e.startDate.toISOString(), timeZone: 'Asia/Seoul' };
  const end = e.allDay
    ? { date: e.endDate.toISOString().slice(0, 10) }
    : { dateTime: e.endDate.toISOString(), timeZone: 'Asia/Seoul' };
  return {
    summary: e.title,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    start,
    end,
    colorId: undefined,
    source: { title: 'Project Office', url: `${process.env.PUBLIC_BASE_URL ?? ''}/calendar` },
    extendedProperties: {
      private: { poEventId: e.id }, // 중복 방지 힌트
    },
  };
}

/**
 * 로컬 이벤트를 Google에 생성/업데이트 (이미 매핑 있으면 update)
 */
export async function pushEventToGoogle(userId: string, event: PoCalendarEvent): Promise<void> {
  if (!config.google.enabled) return;
  try {
    const sync = await prisma.calendarExternalSync.findUnique({ where: { userId } });
    if (!sync || !sync.isActive) return;

    const { client, calendarId } = await getAuthorizedClient(userId);
    const cal = google.calendar({ version: 'v3', auth: client });

    const existing = await prisma.calendarEventExternalMap.findFirst({
      where: { eventId: event.id, provider: 'google' },
    });

    if (existing) {
      await cal.events.update({
        calendarId,
        eventId: existing.externalEventId,
        requestBody: toGoogleEvent(event),
      });
      await prisma.calendarEventExternalMap.update({
        where: { id: existing.id },
        data: { lastSyncedAt: new Date() },
      });
    } else {
      const res = await cal.events.insert({
        calendarId,
        requestBody: toGoogleEvent(event),
      });
      if (res.data.id) {
        await prisma.calendarEventExternalMap.create({
          data: {
            eventId: event.id,
            provider: 'google',
            externalEventId: res.data.id,
            externalCalendarId: calendarId,
          },
        });
      }
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message, userId, eventId: event.id }, '[google-cal] pushEvent failed');
  }
}

export async function deleteEventOnGoogle(userId: string, localEventId: string): Promise<void> {
  if (!config.google.enabled) return;
  try {
    const map = await prisma.calendarEventExternalMap.findFirst({
      where: { eventId: localEventId, provider: 'google' },
    });
    if (!map) return;

    const { client, calendarId } = await getAuthorizedClient(userId);
    const cal = google.calendar({ version: 'v3', auth: client });
    await cal.events.delete({ calendarId, eventId: map.externalEventId });
    await prisma.calendarEventExternalMap.delete({ where: { id: map.id } });
  } catch (e) {
    logger.warn({ err: (e as Error).message, userId, localEventId }, '[google-cal] deleteEvent failed');
  }
}

// ── Pull: Google → 로컬 (수동 "지금 동기화") ──

/** 수동 트리거 시 증분 동기화 — syncToken 기반 */
export async function pullEventsFromGoogle(userId: string): Promise<{ imported: number; updated: number; deleted: number }> {
  const { client, calendarId } = await getAuthorizedClient(userId);
  const cal = google.calendar({ version: 'v3', auth: client });

  const sync = await prisma.calendarExternalSync.findUnique({ where: { userId } });
  const useSyncToken = !!sync?.syncToken;

  const listParams: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    singleEvents: true,
    ...(useSyncToken
      ? { syncToken: sync!.syncToken! }
      : {
          // 첫 동기화: 과거 30일 ~ 미래 365일
          timeMin: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
          timeMax: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
          showDeleted: true,
        }),
    maxResults: 2500,
  };

  let pageToken: string | undefined = undefined;
  let imported = 0, updated = 0, deleted = 0;
  let nextSyncToken: string | undefined;

  do {
    const res: calendar_v3.Schema$Events = (
      await cal.events.list({ ...listParams, pageToken }).catch((e) => {
        // syncToken 만료(410) 시 전체 재동기화
        const status = (e as { status?: number; code?: number })?.status ?? (e as { code?: number })?.code;
        if (status === 410) {
          logger.info({ userId }, '[google-cal] syncToken invalidated — full resync required');
          return { data: { items: [], nextSyncToken: undefined } as calendar_v3.Schema$Events };
        }
        throw e;
      })
    ).data as calendar_v3.Schema$Events;

    for (const item of res.items ?? []) {
      if (!item.id) continue;

      // 이미 우리가 push한 건 스킵 (ownerLoop 방지)
      if (item.extendedProperties?.private?.poEventId) continue;

      const existing = await prisma.calendarEventExternalMap.findUnique({
        where: { provider_externalEventId: { provider: 'google', externalEventId: item.id } },
      });

      if (item.status === 'cancelled') {
        if (existing) {
          await prisma.calendarEvent.update({
            where: { id: existing.eventId },
            data: { isActive: false },
          }).catch(() => {});
          await prisma.calendarEventExternalMap.delete({ where: { id: existing.id } });
          deleted += 1;
        }
        continue;
      }

      const startDate = item.start?.dateTime
        ? new Date(item.start.dateTime)
        : item.start?.date
        ? new Date(`${item.start.date}T00:00:00`)
        : null;
      const endDate = item.end?.dateTime
        ? new Date(item.end.dateTime)
        : item.end?.date
        ? new Date(`${item.end.date}T23:59:59`)
        : null;
      if (!startDate || !endDate) continue;

      const eventData = {
        title: item.summary || '(제목 없음)',
        description: item.description ?? null,
        startDate,
        endDate,
        allDay: !item.start?.dateTime,
        location: item.location ?? null,
        scope: 'personal' as const,
      };

      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.eventId },
          data: eventData,
        });
        await prisma.calendarEventExternalMap.update({
          where: { id: existing.id },
          data: { lastSyncedAt: new Date() },
        });
        updated += 1;
      } else {
        const created = await prisma.calendarEvent.create({
          data: { ...eventData, creatorId: userId },
        });
        await prisma.calendarEventExternalMap.create({
          data: {
            eventId: created.id,
            provider: 'google',
            externalEventId: item.id,
            externalCalendarId: calendarId,
          },
        });
        imported += 1;
      }
    }

    pageToken = res.nextPageToken ?? undefined;
    nextSyncToken = res.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  await prisma.calendarExternalSync.update({
    where: { userId },
    data: {
      lastSyncedAt: new Date(),
      lastSyncError: null,
      ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
    },
  });

  logger.info({ userId, imported, updated, deleted }, '[google-cal] pull complete');
  return { imported, updated, deleted };
}

/** 연동 상태 조회 */
export async function getSyncStatus(userId: string) {
  return prisma.calendarExternalSync.findUnique({
    where: { userId },
    select: {
      provider: true,
      externalAccountId: true,
      externalCalendarId: true,
      scope: true,
      lastSyncedAt: true,
      lastSyncError: true,
      isActive: true,
      createdAt: true,
    },
  });
}
