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
