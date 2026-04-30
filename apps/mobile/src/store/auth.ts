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

    // CallKit pending 통화 정리 — 이전 사용자의 ring 응답을 다른 사용자가 받지 않게 (audit 7차 M3)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { clearPendingCalls } = require('../services/callkeep');
      clearPendingCalls();
    } catch { /* callkeep 미존재 환경 */ }

    set({ user: null, accessToken: null, refreshToken: null });
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.data });
    } catch {
      // 토큰 만료/유효성 실패 시 — logout() 통해 캐시도 함께 wipe (PII 누출 방지)
      // 직접 set 해서 user만 null 로 두면 다음 로그인 사용자에게 이전 사용자 캐시가 노출됨
      get().logout();
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
