/**
 * 다크/라이트 모드 자동 전환 훅
 *
 * useColorScheme() 으로 OS 설정 감지 → 시맨틱 컬러 객체 반환.
 * `userInterfaceStyle: 'automatic'` (app.json) 와 함께 동작.
 *
 * 사용:
 *   const { c, scheme, isDark } = useTheme();
 *   <View style={{ backgroundColor: c.bg }}>
 *
 * StyleSheet 와 함께 쓸 때:
 *   const { c } = useTheme();
 *   const styles = useMemo(() => makeStyles(c), [c]);
 *   const makeStyles = (c) => StyleSheet.create({ ... });
 */
import { useColorScheme } from 'react-native';
import { COLORS, type SemanticColors, type ColorScheme } from '../constants/theme';

export interface ThemeContext {
  c: SemanticColors;
  scheme: ColorScheme;
  isDark: boolean;
}

export function useTheme(): ThemeContext {
  const sys = useColorScheme();
  const scheme: ColorScheme = sys === 'dark' ? 'dark' : 'light';
  const c = scheme === 'dark' ? COLORS.dark : COLORS.light;
  return { c, scheme, isDark: scheme === 'dark' };
}
