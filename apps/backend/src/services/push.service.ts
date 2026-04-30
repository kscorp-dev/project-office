/**
 * 모바일 푸시 알림 서비스 (v0.17.0)
 *
 * Expo Push Notifications 기반 (iOS APNs + Android FCM 통합)
 *
 * 사용 예:
 *   await sendPushToUser(userId, {
 *     title: '결재 요청',
 *     body: '홍길동 - 휴가 신청서',
 *     data: { link: '/approval/documents/abc' },
 *   });
 *
 * 환경 변수:
 *   EXPO_ACCESS_TOKEN  — Expo 프로젝트 대시보드에서 발급 (프로덕션 권장)
 *                        미설정 시에도 동작하지만 rate limit 엄격
 *   DISABLE_PUSH=true — 테스트/CI 환경에서 발송 스킵
 *
 * 토큰 관리:
 *   클라이언트(Expo 앱)가 expo-notifications로 획득한
 *   `ExponentPushToken[...]` 문자열을 UserDevice.pushToken에 저장.
 */
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import prisma from '../config/prisma';
import { logger } from '../config/logger';

let _expo: Expo | null = null;

function getExpo(): Expo {
  if (!_expo) {
    _expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
    });
  }
  return _expo;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** iOS 배지 숫자 */
  badge?: number;
  /** 카테고리 (iOS 액션 버튼) */
  categoryId?: string;
}

/**
 * 특정 사용자의 모든 활성 디바이스로 푸시 전송
 * @returns {sent, failed, invalidTokens}
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  if (process.env.DISABLE_PUSH === 'true') {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const devices = await prisma.userDevice.findMany({
    where: { userId, isActive: true, pushToken: { not: null } },
    select: { id: true, pushToken: true, deviceType: true },
  });

  const tokens = devices
    .map((d) => d.pushToken!)
    .filter((t) => Expo.isExpoPushToken(t));

  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  return sendPushToTokens(tokens, payload);
}

/** 토큰 배열에 직접 푸시 전송 (내부 사용) */
export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  if (process.env.DISABLE_PUSH === 'true') {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const expo = getExpo();
  const messages: ExpoPushMessage[] = tokens
    .filter((t) => Expo.isExpoPushToken(t))
    .map((token) => ({
      to: token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      badge: payload.badge,
      categoryId: payload.categoryId,
      priority: 'high',
    }));

  if (messages.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  // Expo 권장: 최대 100개씩 chunk
  const chunks = expo.chunkPushNotifications(messages);
  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i] as ExpoPushTicket;
        if (t.status === 'ok') {
          sent += 1;
        } else {
          failed += 1;
          const err = t.details?.error;
          if (err === 'DeviceNotRegistered' || err === 'InvalidCredentials') {
            invalidTokens.push(chunk[i].to as string);
          }
          logger.warn(
            { err, message: t.message },
            '[push] expo ticket error',
          );
        }
      }
    } catch (e) {
      failed += chunk.length;
      logger.error({ err: e }, '[push] chunk send failed');
    }
  }

  // 유효하지 않은 토큰은 비활성화 (재발송 방지)
  if (invalidTokens.length > 0) {
    await prisma.userDevice
      .updateMany({
        where: { pushToken: { in: invalidTokens } },
        data: { isActive: false, pushToken: null },
      })
      .catch(() => { /* ignore */ });
  }

  return { sent, failed, invalidTokens };
}

/** 디바이스 토큰 등록 / 갱신 (upsert) */
export async function registerPushToken(params: {
  userId: string;
  deviceId: string;
  deviceType: 'ios' | 'android' | 'web';
  deviceName: string;
  pushToken: string;
}): Promise<void> {
  if (!Expo.isExpoPushToken(params.pushToken)) {
    throw new Error(`Invalid Expo push token: ${String(params.pushToken).slice(0, 20)}...`);
  }

  await prisma.userDevice.upsert({
    where: { userId_deviceId: { userId: params.userId, deviceId: params.deviceId } },
    update: {
      pushToken: params.pushToken,
      deviceName: params.deviceName,
      deviceType: params.deviceType,
      isActive: true,
      lastUsedAt: new Date(),
    },
    create: {
      userId: params.userId,
      deviceId: params.deviceId,
      deviceType: params.deviceType,
      deviceName: params.deviceName,
      pushToken: params.pushToken,
    },
  });
}

/** 디바이스 비활성 (로그아웃 시) */
export async function unregisterPushToken(userId: string, deviceId: string): Promise<void> {
  await prisma.userDevice.updateMany({
    where: { userId, deviceId },
    data: { isActive: false, pushToken: null },
  });
}

/**
 * 푸시 발송 환경 헬스체크.
 * 서버 부팅 시 호출 → logger 로 현재 푸시 설정 상태를 출력해서
 * 운영자가 "왜 푸시가 안 가지?" 디버그 시간을 줄여준다.
 */
export interface PushHealth {
  enabled: boolean;
  hasAccessToken: boolean;
  totalActiveDevices: number;
  iosDevices: number;
  androidDevices: number;
  warnings: string[];
}

export async function pushHealthCheck(): Promise<PushHealth> {
  const enabled = process.env.DISABLE_PUSH !== 'true';
  const hasAccessToken = !!process.env.EXPO_ACCESS_TOKEN;
  const warnings: string[] = [];

  if (!enabled) warnings.push('DISABLE_PUSH=true — 푸시 발송 OFF (테스트 모드)');
  if (enabled && !hasAccessToken) {
    warnings.push('EXPO_ACCESS_TOKEN 미설정 — Expo rate limit 엄격 (분당 ~600건)');
  }
  if (process.env.NODE_ENV === 'production' && !hasAccessToken) {
    warnings.push('⚠️ PRODUCTION 환경에서 EXPO_ACCESS_TOKEN 가 비어있음 — 즉시 설정 권장');
  }

  let totalActiveDevices = 0;
  let iosDevices = 0;
  let androidDevices = 0;
  try {
    const counts = await prisma.userDevice.groupBy({
      by: ['deviceType'],
      where: { isActive: true, pushToken: { not: null } },
      _count: { _all: true },
    });
    for (const row of counts) {
      const n = row._count._all;
      totalActiveDevices += n;
      if (row.deviceType === 'ios') iosDevices = n;
      if (row.deviceType === 'android') androidDevices = n;
    }
  } catch (e) {
    warnings.push(`디바이스 카운트 실패: ${(e as Error).message}`);
  }

  if (enabled && totalActiveDevices === 0) {
    warnings.push('등록된 활성 디바이스 0개 — 모바일 앱이 토큰 등록을 못 했거나 첫 사용자 부재');
  }

  return { enabled, hasAccessToken, totalActiveDevices, iosDevices, androidDevices, warnings };
}

/**
 * 관리자 콘솔에서 본인에게 테스트 푸시 보내기.
 * 라우트 핸들러가 이 함수를 호출 → 본인 디바이스에 알림 도착하면 "프로덕션 푸시 OK" 검증 완료.
 */
export async function sendTestPush(userId: string): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  invalidTokens: string[];
  reason?: string;
}> {
  if (process.env.DISABLE_PUSH === 'true') {
    return { attempted: 0, sent: 0, failed: 0, invalidTokens: [], reason: 'DISABLE_PUSH=true' };
  }
  const result = await sendPushToUser(userId, {
    title: '🔔 테스트 알림',
    body: `Project Office 푸시 발송 검증 — ${new Date().toLocaleString('ko-KR')}`,
    data: { type: 'system', test: '1' },
  });
  const devices = await prisma.userDevice.count({
    where: { userId, isActive: true, pushToken: { not: null } },
  });
  return { attempted: devices, ...result };
}
