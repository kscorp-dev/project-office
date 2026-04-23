import axios from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/auth';

/**
 * API Base URL 결정 순서:
 *   1. `eas.json`의 `build.<profile>.env.API_URL` (EAS Build 시 process.env로 주입)
 *   2. `app.json`의 `expo.extra.apiUrl` (로컬 개발 override)
 *   3. 기본값 (Android 에뮬레이터의 localhost = 10.0.2.2)
 *
 * iOS 시뮬레이터: `http://localhost:3000/api`
 * 실기기: 같은 네트워크의 개발 머신 IP (`http://192.168.x.x:3000/api`)
 * Production: `https://43-200-29-148.sslip.io/api`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extra = (Constants.expoConfig?.extra ?? (Constants.manifest as any)?.extra ?? {}) as {
  apiUrl?: string;
};

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ||
  extra.apiUrl ||
  'http://10.0.2.2:3000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefreshToken } = data.data;
        useAuthStore.getState().setTokens(accessToken, newRefreshToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
