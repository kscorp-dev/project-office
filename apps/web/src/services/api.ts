import axios, { type AxiosRequestConfig, type AxiosError } from 'axios';
import { useAuthStore } from '../store/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request: Access Token 자동 첨부
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Refresh Token Race Condition 방지
 *
 * 동시에 여러 요청이 401을 받으면 각각 refresh를 호출하려 한다.
 * 서버는 refresh token rotation을 쓰므로 첫 요청만 성공하고 나머지는 실패 →
 * 사용자 강제 로그아웃 발생.
 *
 * 해결: 진행 중인 refresh promise가 있으면 모두 그 결과를 await 한다.
 */
let refreshPromise: Promise<string> | null = null;

async function performTokenRefresh(refreshToken: string): Promise<string> {
  // axios 인스턴스가 아닌 raw axios로 호출 (interceptor 재귀 방지)
  const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
  const { accessToken, refreshToken: newRefreshToken } = data.data;
  useAuthStore.getState().setTokens(accessToken, newRefreshToken);
  return accessToken;
}

// Response: 401 시 토큰 갱신 시도 (동시 요청 coalescing)
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // refresh 자체가 실패한 경우 — 무한루프 방지
    if (originalRequest.url?.includes('/auth/refresh')) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    try {
      // 이미 진행 중인 refresh가 있으면 그것을 재사용, 없으면 새로 시작
      if (!refreshPromise) {
        refreshPromise = performTokenRefresh(refreshToken).finally(() => {
          // 완료/실패 관계없이 다음 라운드를 위해 해제
          refreshPromise = null;
        });
      }

      const newAccessToken = await refreshPromise;

      // 원래 요청 재시도
      originalRequest.headers = originalRequest.headers ?? {};
      (originalRequest.headers as Record<string, string>).Authorization = `Bearer ${newAccessToken}`;
      return api(originalRequest);
    } catch {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }
  },
);

export default api;
