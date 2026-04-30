import { useEffect, useState, useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/auth';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { initOfflineDb } from '../src/offline-db';
import { setupCallKeep } from '../src/services/callkeep';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { useTheme } from '../src/hooks/useTheme';

function buildPaperTheme(isDark: boolean) {
  const base = isDark ? MD3DarkTheme : MD3LightTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: isDark ? '#4ade80' : '#22c55e',
      primaryContainer: isDark ? '#13261c' : '#dcfce7',
      secondary: isDark ? '#22c55e' : '#16a34a',
      background: isDark ? '#0b1210' : '#f8fdf9',
      surface: isDark ? '#111b17' : '#ffffff',
      onSurface: isDark ? '#f1f5f3' : '#111827',
      error: '#ef4444',
    },
  };
}

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const [dbReady, setDbReady] = useState(false);
  const { isDark, c } = useTheme();
  const paperTheme = useMemo(() => buildPaperTheme(isDark), [isDark]);

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

  // 다크 모드에 맞는 헤더/스택 옵션
  const headerOpts = {
    headerStyle: { backgroundColor: c.surface },
    headerTitleStyle: { color: c.text },
    headerTintColor: c.text,
    contentStyle: { backgroundColor: c.bg },
  } as const;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, ...headerOpts }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="meeting/index" options={{ headerShown: true, title: '화상회의', ...headerOpts }} />
            <Stack.Screen name="meeting/[id]" options={{ headerShown: true, title: '회의 상세', ...headerOpts }} />
            <Stack.Screen name="meeting/[id]/room" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="messenger/room/[id]" options={{ headerShown: true, ...headerOpts }} />
            <Stack.Screen name="approval/[id]" options={{ headerShown: true, ...headerOpts }} />
            <Stack.Screen name="task-orders/[id]" options={{ headerShown: true, ...headerOpts }} />
            <Stack.Screen name="notifications" options={{ headerShown: true, title: '알림', ...headerOpts }} />
            <Stack.Screen name="settings/calendar-sync" options={{ headerShown: true, title: '외부 캘린더 연동', ...headerOpts }} />
            <Stack.Screen name="settings/delegation" options={{ headerShown: true, title: '결재 위임', ...headerOpts }} />
            <Stack.Screen name="mail/[uid]" options={{ headerShown: true, ...headerOpts }} />
            <Stack.Screen name="mail/compose" options={{ headerShown: true, ...headerOpts }} />
          </Stack>
        </PaperProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
