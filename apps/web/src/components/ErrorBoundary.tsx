import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** 에러 UI 대신 자식을 숨기는 대체 렌더 함수 (선택) */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 에러 발생 시 콜백 (로깅용) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * React 컴포넌트 크래시를 포착해 앱 전체 흰 화면을 방지한다.
 *
 * 한계: Error Boundary는 이벤트 핸들러, 비동기 코드,
 * SSR/렌더 외부 에러는 포착하지 못한다. 그런 경우엔 window.onerror 등 별도 처리 필요.
 *
 * 사용:
 *   <ErrorBoundary>
 *     <Routes>...</Routes>
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 콘솔에는 항상 기록 (dev tools에서 바로 보이도록)
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 컴포넌트 에러 포착', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private reset = () => this.setState({ error: null });

  private goHome = () => {
    this.setState({ error: null });
    window.location.href = '/';
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    // 기본 fallback UI
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              예상치 못한 오류가 발생했습니다
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
              아래 버튼으로 다시 시도하거나 홈으로 이동해주세요.
            </p>

            {/* 개발 모드에서만 에러 메시지 노출 */}
            {import.meta.env.DEV && (
              <pre className="w-full text-left bg-gray-100 dark:bg-gray-900 rounded-lg p-3 text-xs text-red-600 dark:text-red-400 mb-6 overflow-x-auto whitespace-pre-wrap break-words">
                {error.name}: {error.message}
              </pre>
            )}

            <div className="flex gap-2 w-full">
              <button
                onClick={this.reset}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                다시 시도
              </button>
              <button
                onClick={this.goHome}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
              >
                <Home className="w-4 h-4" />
                홈으로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
