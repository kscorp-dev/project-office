import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/auth';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { initOfflineDb } from '../src/offline-db';
import { setupCallKeep } from '../src/services/callkeep';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#22c55e',
    primaryContainer: '#dcfce7',
    secondary: '#16a34a',
    background: '#f8fdf9',
    surface: '#ffffff',
    error: '#ef4444',
  },
};

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    // 병렬 초기화: auth 세션 복구, SQLite DB, CallKit
    let cancelled = false;
    Promise.allSettled([
      initialize(),
      initOfflineDb(),
      setupCallKeep(),
    ]).then(() => {
      if (!cancelled) setDbReady(true);
    });
    return () => { cancelled = true; };
    // initialize 는 zustand action 이라 레퍼런스 안정 — deps 비움 ok
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 푸시 토큰 등록 (로그인 상태 되면 내부에서 한 번만 실행)
  usePushNotifications();

  // DB 초기화 대기 중엔 화면 그대로 유지. Splash image 계속 보이므로 깜빡임 없음.
  if (!dbReady) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="meeting/index" options={{ headerShown: true, title: '화상회의' }} />
            <Stack.Screen name="meeting/[id]" options={{ headerShown: true, title: '회의 상세' }} />
            <Stack.Screen name="meeting/[id]/room" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="messenger/room/[id]" options={{ headerShown: true }} />
            <Stack.Screen name="approval/[id]" options={{ headerShown: true }} />
            <Stack.Screen name="notifications" options={{ headerShown: true, title: '알림' }} />
            <Stack.Screen name="settings/calendar-sync" options={{ headerShown: true, title: '외부 캘린더 연동' }} />
          </Stack>
        </PaperProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
