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

      // SecureStore 저장
      const SecureStore = require('expo-secure-store');
      await SecureStore.setItemAsync('accessToken', accessToken);
      await SecureStore.setItemAsync('refreshToken', refreshToken);

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
