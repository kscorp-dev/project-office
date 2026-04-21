import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { accessToken, isBootstrapping } = useAuthStore();

  // 앱 시작 시 토큰 복구/검증 중 — 깜빡임 방지용 로딩 화면
  if (isBootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">세션 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
