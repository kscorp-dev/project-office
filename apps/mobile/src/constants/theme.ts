/**
 * 디자인 토큰 — 부록 G 정의와 1:1 매핑.
 *
 * 사용:
 *   import { COLORS, SPACING, RADIUS, TYPO } from '@/constants/theme'
 *   <View style={{ padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surface }}>
 */
import { Platform } from 'react-native';

// ────────────────── COLOR ──────────────────

const primary = {
  50: '#f0fdf4',
  100: '#dcfce7',
  200: '#bbf7d0',
  300: '#86efac',
  400: '#4ade80',
  500: '#22c55e',
  600: '#16a34a',
  700: '#15803d',
  800: '#166534',
  900: '#14532d',
} as const;

const gray = {
  50: '#f9fafb',
  100: '#f3f4f6',
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#111827',
} as const;

/** 라이트 모드 (기본) */
const lightSemantic = {
  bg:        '#f8fdf9',
  surface:   '#ffffff',
  text:      gray[900],
  textMuted: gray[500],
  border:    gray[200],
  divider:   gray[100],
  focus:     primary[500],
} as const;

/** 다크 모드 (Phase 0 후반 적용 예정) */
const darkSemantic = {
  bg:        '#0b1210',
  surface:   '#111b17',
  text:      '#f1f5f3',
  textMuted: '#9aa79f',
  border:    '#1f2b25',
  divider:   '#162019',
  focus:     primary[400],
} as const;

export const COLORS = {
  primary,
  gray,
  white: '#ffffff',
  black: '#000000',
  danger:  '#ef4444',
  warning: '#f59e0b',
  info:    '#3b82f6',
  success: '#10b981',
  ...lightSemantic,
  light: lightSemantic,
  dark:  darkSemantic,
} as const;

// ────────────────── SPACING (8pt grid) ──────────────────

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

// ────────────────── RADIUS ──────────────────

export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

// ────────────────── TYPOGRAPHY ──────────────────

export const TYPO = {
  display:  { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  h1:       { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  h2:       { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  h3:       { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body:     { fontSize: 14, lineHeight: 22, fontWeight: '400' as const },
  bodyBold: { fontSize: 14, lineHeight: 22, fontWeight: '600' as const },
  meta:     { fontSize: 12, lineHeight: 18, fontWeight: '400' as const },
  caption:  { fontSize: 11, lineHeight: 16, fontWeight: '400' as const },
  overline: { fontSize: 10, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.8 },
  mono:     {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: (Platform.OS === 'ios' ? 'Menlo' : 'monospace'),
  },
} as const;

// ────────────────── ELEVATION (shadow) ──────────────────

export const ELEVATION = {
  none:  { shadowOpacity: 0, elevation: 0 },
  card:  {
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  modal: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 6,
  },
} as const;

// ────────────────── TOUCH TARGET ──────────────────

/** 최소 터치 타겟 (iOS HIG/Material 기준) */
export const MIN_TOUCH = 44;

// ────────────────── FONT (레거시 호환) ──────────────────

export const FONT = {
  regular: 'System',
  medium:  'System',
  bold:    'System',
} as const;

