import { create } from 'zustand';
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
  error: string | null;

  login: (employeeId: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  setTokens: (access: string, refresh: string) => void;
  clearError: () => void;
}

interface RegisterData {
  employeeId: string;
  email: string;
  name: string;
  password: string;
  departmentId?: string;
  position?: string;
  phone?: string;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  error: null,

  login: async (employeeId, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await api.post('/auth/login', {
        employeeId,
        password,
        deviceInfo: {
          deviceId: getDeviceId(),
          deviceType: 'web',
          deviceName: navigator.userAgent.slice(0, 100),
        },
      });
      const { accessToken, refreshToken, user } = data.data;
      set({ user, accessToken, refreshToken, isLoading: false });
    } catch (err: any) {
      const message = err.response?.data?.error?.message || '로그인에 실패했습니다';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  register: async (registerData) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/auth/register', registerData);
      set({ isLoading: false });
    } catch (err: any) {
      const message = err.response?.data?.error?.message || '회원가입에 실패했습니다';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  logout: () => {
    const { accessToken, refreshToken } = get();
    if (accessToken) {
      api.post('/auth/logout', { refreshToken }).catch(() => {});
    }
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
  },

  clearError: () => set({ error: null }),
}));

function getDeviceId(): string {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
}
