import { create } from 'zustand';
import { Platform } from 'react-native';
import { api } from '../services/api';

interface User {
  id: string;
  employeeId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  position?: string;
  profileImage?: string;
  departmentId?: string;
  department?: { id: string; name: string; code: string };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isReady: boolean;
  error: string | null;

  login: (employeeId: string, password: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  setTokens: (access: string, refresh: string) => void;
  clearError: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  isReady: false,
  error: null,

  initialize: async () => {
    try {
      const SecureStore = require('expo-secure-store');
      const accessToken = await SecureStore.getItemAsync('accessToken');
      const refreshToken = await SecureStore.getItemAsync('refreshToken');
      if (accessToken && refreshToken) {
        set({ accessToken, refreshToken });
        await get().fetchMe();
      }
    } catch {
      // no stored tokens
    } finally {
      set({ isReady: true });
    }
  },

  login: async (employeeId, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await api.post('/auth/login', {
        employeeId,
        password,
        deviceInfo: {
          deviceId: `mobile-${Date.now()}`,
          deviceType: Platform.OS,
          deviceName: `${Platform.OS} ${Platform.Version}`,
        },
      });
      const { accessToken, refreshToken, user } = data.data;
      const previousUserId = get().user?.id;

      // SecureStore 저장
      const SecureStore = require('expo-secure-store');
      await SecureStore.setItemAsync('accessToken', accessToken);
      await SecureStore.setItemAsync('refreshToken', refreshToken);

      // 다른 계정으로 로그인 시 이전 사용자의 캐시 wipe (PII 보호)
      if (previousUserId && previousUserId !== user.id) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { clearOfflineDb } = require('../offline-db');
          await clearOfflineDb().catch(() => { /* ignore */ });
        } catch { /* offline-db 미초기화 */ }
      }

      set({ user, accessToken, refreshToken, isLoading: false });
    } catch (err: any) {
      const message = err.response?.data?.error?.message || '로그인에 실패했습니다';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  logout: () => {
    const { accessToken, refreshToken } = get();
    if (accessToken) {
      api.post('/auth/logout', { refreshToken }).catch(() => {});
    }

    const SecureStore = require('expo-secure-store');
    SecureStore.deleteItemAsync('accessToken').catch(() => {});
    SecureStore.deleteItemAsync('refreshToken').catch(() => {});

    // 보안 — 다음 사용자가 이전 사용자의 캐시(메시지/메일/캘린더 본문)를 보지 못하도록
    // 로컬 SQLite 데이터 wipe. 실패해도 로그아웃 자체는 진행.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { clearOfflineDb } = require('../offline-db');
      clearOfflineDb().catch(() => { /* ignore */ });
    } catch { /* offline-db 미초기화 환경 */ }

    set({ user: null, accessToken: null, refreshToken: null });
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.data });
    } catch {
      set({ user: null, accessToken: null, refreshToken: null });
    }
  },

  setTokens: (access, refresh) => {
    set({ accessToken: access, refreshToken: refresh });
    const SecureStore = require('expo-secure-store');
    SecureStore.setItemAsync('accessToken', access).catch(() => {});
    SecureStore.setItemAsync('refreshToken', refresh).catch(() => {});
  },

  clearError: () => set({ error: null }),
}));
