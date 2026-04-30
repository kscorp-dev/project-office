/**
 * Expo Push Notifications 토큰 등록 훅 (v0.17.0)
 *
 * 사용: 앱 최상단(_layout.tsx 또는 tabs 진입 시) 한 번 호출
 *   usePushNotifications();
 *
 * 흐름:
 *   1. expo-notifications 권한 요청
 *   2. Expo push token 획득
 *   3. POST /notifications/devices — 백엔드에 토큰 등록
 *   4. 포그라운드 알림 수신 리스너 등록 (Badge 갱신용)
 *
 * 주의:
 *   - 실기기에서만 토큰 발급 (Expo Go / 시뮬레이터는 개발용 limited 토큰)
 *   - 앱 재시작 시 토큰 갱신되는 경우 있으므로 매 부팅마다 호출 권장
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';
import { displayIncomingMeetingCall, endIncomingCall } from '../services/callkeep';

// expo-notifications를 조건부 require — Expo Go/일부 환경에서 없을 수 있음
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  // 모듈 없으면 noop
}

// 알림 ID → CallKit UUID 매핑 (거절 시 endIncomingCall 호출용)
const recentRingUuids = new Map<string, string>();

function generateCallUUID(): string {
  // RFC 4122 v4 간이 구현
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function usePushNotifications() {
  const user = useAuthStore((s) => s.user);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!Notifications) return;
    if (!user) return;

    // 포그라운드에서 알림 배너 표시
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // ─── Notification Categories: 인라인 액션 버튼 정의 ───
    // category=approval (data.type='approval') 알림은 잠금화면에서 [승인] [반려] 버튼 노출
    Notifications.setNotificationCategoryAsync?.('approval', [
      {
        identifier: 'APPROVE',
        buttonTitle: '✓ 승인',
        options: { opensAppToForeground: true }, // 생체 인증 필요해서 앱 진입
      },
      {
        identifier: 'REJECT',
        buttonTitle: '✕ 반려',
        options: { opensAppToForeground: true },
      },
    ]).catch(() => { /* iOS 14 미만 / 환경에 따라 미지원 */ });

    Notifications.setNotificationCategoryAsync?.('message', [
      {
        identifier: 'REPLY',
        buttonTitle: '답장',
        textInput: { submitButtonTitle: '전송', placeholder: '빠른 답장...' },
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'MARK_READ',
        buttonTitle: '읽음',
        options: { opensAppToForeground: false },
      },
    ]).catch(() => { /* ignore */ });

    // 회의 초대: 잠금화면에서 [수락]/[거절] 버튼 노출
    // - 수락: 앱 포그라운드 진입 → /meeting/:id
    // - 거절: 백그라운드에서 단순 dismiss (TODO: 서버에 거절 신호 전송)
    Notifications.setNotificationCategoryAsync?.('meeting', [
      {
        identifier: 'ACCEPT',
        buttonTitle: '✓ 수락',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'DECLINE',
        buttonTitle: '✕ 거절',
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]).catch(() => { /* ignore */ });

    // ─── 알림 탭 시 딥링크 ───
    // payload.data.path 가 있으면 router.push, 그 외 typed 변환:
    //   { type: 'approval', id: 'uuid' }       → /approval/:id
    //   { type: 'message',  roomId: 'uuid' }   → /messenger/room/:id
    //   { type: 'mail',     uid: '12345' }     → /mail
    //   { type: 'meeting',  id: 'uuid' }       → /meeting/:id
    //   { type: 'calendar', id: 'uuid' }       → /calendar
    function resolveDeepLink(data: Record<string, unknown> | undefined): string | null {
      if (!data) return null;
      if (typeof data.path === 'string' && data.path.startsWith('/')) return data.path;
      switch (data.type) {
        case 'approval': return data.id ? `/approval/${data.id}` : null;
        case 'message':  return data.roomId ? `/messenger/room/${data.roomId}` : null;
        case 'mail':     return '/mail';
        case 'meeting':  return data.id ? `/meeting/${data.id}` : null;
        case 'calendar': return '/calendar';
        case 'task':     return data.id ? `/task-orders/${data.id}` : '/task-orders';
        case 'vacation': return '/attendance';
        case 'post':     return '/board';
        default:
          // 호환: 백엔드가 보내는 link 필드를 fallback 으로
          if (typeof data.link === 'string' && data.link.startsWith('/')) {
            // 웹 link 는 '/approval/documents/:id' 형태일 수 있음 → 모바일 라우트로 변환
            const link = data.link as string;
            const m = link.match(/^\/approval\/documents\/([\w-]+)/);
            if (m) return `/approval/${m[1]}`;
            return link.startsWith('/') ? link : null;
          }
          return null;
      }
    }

    // 메시지 수신 리스너 — 포그라운드에서 회의 초대(ring) 도착 시 CallKit UI 트리거
    // (백그라운드/lockscreen 은 OS 가 categoryId='meeting' 으로 처리)
    const receivedSub = Notifications.addNotificationReceivedListener?.(
      (notification: any) => {
        const data = notification?.request?.content?.data ?? {};
        if (data.type !== 'meeting') return;
        if (data.ring !== '1' && data.ring !== true) return;
        const meetingId = typeof data.id === 'string' ? data.id : null;
        if (!meetingId) return;

        // 포그라운드에서만 CallKit 띄움 (백그라운드는 OS 알림이 처리)
        const appState = AppState.currentState;
        if (appState !== 'active') return;

        const callerName = typeof data.hostName === 'string' && data.hostName
          ? data.hostName
          : '회의 초대';
        const uuid = generateCallUUID();
        try {
          displayIncomingMeetingCall(uuid, meetingId, callerName, true);
          // 알림 ID 와 UUID 매핑 — 거절 시 endIncomingCall 호출 가능
          if (typeof data.notificationId === 'string') {
            recentRingUuids.set(data.notificationId, uuid);
          }
        } catch (e) {
          console.warn('[push] CallKit display failed', e);
        }
      },
    );

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      async (response: any) => {
        const content = response?.notification?.request?.content;
        const data = content?.data ?? {};
        const actionId = response?.actionIdentifier;

        // ── 인라인 액션 처리 ──
        // EXPO_DEFAULT_ACTION_IDENTIFIER 또는 'default' 는 알림 본체 탭 → 딥링크 진입
        const isDefault = !actionId
          || actionId === 'default'
          || actionId === 'expo.modules.notifications.actions.DEFAULT';

        if (!isDefault) {
          try {
            if (actionId === 'APPROVE' && data.id) {
              // 결재 인라인 승인은 생체 인증이 필요하므로 앱 foreground 진입 후
              // approval/[id] 화면이 받도록 딥링크 + ?action=approve 전달
              router.push(`/approval/${data.id}?action=approve` as any);
              return;
            }
            if (actionId === 'REJECT' && data.id) {
              router.push(`/approval/${data.id}?action=reject` as any);
              return;
            }
            if (actionId === 'REPLY' && data.roomId) {
              const text = response?.userText as string | undefined;
              if (text && text.trim()) {
                await api.post(`/messenger/rooms/${data.roomId}/messages`, {
                  type: 'text',
                  content: text.trim(),
                });
              }
              return;
            }
            if (actionId === 'MARK_READ' && data.roomId) {
              // 서버 측 read mark — Socket 없이도 REST 로 lastReadAt 갱신
              await api.get(`/messenger/rooms/${data.roomId}/messages?limit=1`);
              return;
            }
            if (actionId === 'ACCEPT' && data.id && data.type === 'meeting') {
              // 수락: 회의방 진입 (foreground 자동 전환)
              router.push(`/meeting/${data.id}` as any);
              return;
            }
            if (actionId === 'DECLINE' && data.type === 'meeting') {
              // 거절: 진행 중인 CallKit UI 종료 + 서버 거절 신호 (베스트-에포트)
              const notifId = typeof data.notificationId === 'string' ? data.notificationId : null;
              const uuid = notifId ? recentRingUuids.get(notifId) : undefined;
              if (uuid) {
                endIncomingCall(uuid);
                recentRingUuids.delete(notifId!);
              }
              if (data.id) {
                api.post(`/meeting/${data.id}/decline`, {}).catch(() => { /* 엔드포인트 미구현이어도 무시 */ });
              }
              return;
            }
          } catch (err) {
            console.warn('[push] action failed', actionId, err);
          }
          return;
        }

        // ── 본체 탭 → 딥링크 ──
        const path = resolveDeepLink(data);
        if (path) {
          // expo-router 의 router.push 가 즉시 동작하지 않을 수 있으므로 setTimeout
          setTimeout(() => router.push(path as any), 100);
        }
      },
    );

    // 콜드 스타트 (앱이 죽어 있다 알림 탭으로 부팅)
    Notifications.getLastNotificationResponseAsync().then((res: any) => {
      if (!res) return;
      const data = res?.notification?.request?.content?.data;
      const path = resolveDeepLink(data);
      if (path) setTimeout(() => router.push(path as any), 500);
    }).catch(() => { /* ignore */ });

    const cleanup = () => {
      try { responseSub?.remove?.(); } catch { /* ignore */ }
      try { receivedSub?.remove?.(); } catch { /* ignore */ }
    };

    if (registeredRef.current) {
      return cleanup;
    }

    (async () => {
      try {
        // 권한 확인/요청
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.warn('[push] permission not granted');
          return;
        }

        // Android 알림 채널 (중요도 high)
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance?.HIGH ?? 4,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#22c55e',
          });
        }

        // Expo push token 획득
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const projectId =
          (Constants.expoConfig?.extra as any)?.eas?.projectId ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (Constants.manifest as any)?.extra?.eas?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        const pushToken = tokenData.data;
        if (!pushToken) return;

        // 디바이스 정보
        const deviceId = Constants.deviceName || 'unknown-device';
        const deviceName = Constants.deviceName || 'Mobile';
        const deviceType = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

        await api.post('/notifications/devices', {
          deviceId,
          deviceType,
          deviceName,
          pushToken,
        });
        registeredRef.current = true;
      } catch (e) {
        console.warn('[push] register failed', e);
      }
    })();

    return cleanup;
  }, [user]);
}
