/**
 * 전역 에러 경계 — 하위 트리의 JS 예외를 포착해 플레이스홀더 UI 로 폴백.
 *
 * RN 기본으론 ErrorBoundary 미제공 → 런타임 크래시 시 빨간 화면 (dev) 또는
 * 앱 전체 재시작 (prod). 이 컴포넌트로 각 주요 라우트를 감싸 부분 복구 가능.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../constants/theme';

interface Props {
  children: React.ReactNode;
  /** 에러 발생 시 상위로 로깅용 콜백 (Sentry 등 연동) */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** 커스텀 fallback. 제공 안하면 기본 UI */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 운영 환경에선 console.error 가 Sentry/Crashlytics 로 전송될 수 있게
    // 배선 가능 (현재는 콘솔만)
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>화면에 문제가 발생했습니다</Text>
          <Text style={styles.message} numberOfLines={4}>
            {this.state.error.message || '알 수 없는 오류'}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={this.reset}>
            <Text style={styles.btnText}>다시 시도</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            문제가 계속되면 앱을 종료한 뒤 다시 실행해주세요.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1, padding: SPACING.xxl, backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center', gap: SPACING.md,
  },
  emoji: { fontSize: 48 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.gray[800] },
  message: {
    fontSize: 13, color: COLORS.gray[500], textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  btn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary[500],
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.md,
  },
  btnText: { color: COLORS.white, fontWeight: '700' },
  hint: { fontSize: 11, color: COLORS.gray[400], textAlign: 'center' },
});
