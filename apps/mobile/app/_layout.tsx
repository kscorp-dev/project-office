import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { useAuthStore } from '../src/store/auth';

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

  useEffect(() => {
    initialize();
  }, []);

  return (
    <PaperProvider theme={theme}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="meeting/index" options={{ headerShown: true, title: '화상회의' }} />
        <Stack.Screen name="meeting/[id]" options={{ headerShown: true, title: '회의 상세' }} />
        <Stack.Screen name="meeting/[id]/room" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      </Stack>
    </PaperProvider>
  );
}
