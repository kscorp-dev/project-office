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
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';

// expo-notifications를 조건부 require — Expo Go/일부 환경에서 없을 수 있음
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  // 모듈 없으면 noop
}

export function usePushNotifications() {
  const user = useAuthStore((s) => s.user);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!Notifications) return;
    if (!user) return;
    if (registeredRef.current) return;

    // 포그라운드에서 알림 배너 표시
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

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
  }, [user]);
}
