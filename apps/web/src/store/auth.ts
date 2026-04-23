import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { useModulesStore } from './modules';

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
  isBootstrapping: boolean;   // 앱 마운트 시 세션 복구 진행 중 여부
  error: string | null;

  login: (employeeId: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  bootstrap: () => Promise<void>; // 앱 시작 시 토큰 기반 세션 복구
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      isBootstrapping: true,
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
          // 로그인 성공 시 활성 모듈 목록을 즉시 로드 (Layout 네비게이션 필터링용)
          useModulesStore.getState().fetch().catch(() => { /* ignore */ });
        } catch (err: any) {
          // 429 Rate Limit — 친화적 안내 메시지 생성
          let message: string;
          if (err.response?.status === 429) {
            const retryAfter = err.response.headers?.['retry-after'];
            const minutes = retryAfter ? Math.ceil(parseInt(retryAfter, 10) / 60) : null;
            message = minutes
              ? `로그인 시도가 너무 많습니다. 약 ${minutes}분 후 다시 시도해주세요.`
              : '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
          } else {
            message = err.response?.data?.error?.message || '로그인에 실패했습니다';
          }
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
        useModulesStore.getState().reset();
        // persist storage도 정리 (민감정보 즉시 제거)
        try {
          localStorage.removeItem('auth-storage');
        } catch { /* SSR/Safari private mode */ }
      },

      fetchMe: async () => {
        try {
          const { data } = await api.get('/auth/me');
          set({ user: data.data });
        } catch {
          // 토큰 만료/무효 — 전체 세션 클리어
          set({ user: null, accessToken: null, refreshToken: null });
        }
      },

      /**
       * 앱 마운트 시 한 번 호출.
       * persist된 토큰이 있으면 /auth/me로 유효성 검증 후 user 복구.
       * 토큰 없으면 즉시 bootstrapping 종료.
       */
      bootstrap: async () => {
        const { accessToken } = get();
        if (!accessToken) {
          set({ isBootstrapping: false });
          return;
        }
        try {
          const { data } = await api.get('/auth/me');
          set({ user: data.data, isBootstrapping: false });
          // 세션 복구 직후 모듈 상태도 동기화
          useModulesStore.getState().fetch().catch(() => { /* ignore */ });
        } catch {
          // 토큰 무효 — 정리
          set({ user: null, accessToken: null, refreshToken: null, isBootstrapping: false });
          useModulesStore.getState().reset();
        }
      },

      setTokens: (access, refresh) => {
        set({ accessToken: access, refreshToken: refresh });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      // persist 대상: 토큰과 user 기본 정보만 (isLoading/error 등은 제외)
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

function getDeviceId(): string {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
}
