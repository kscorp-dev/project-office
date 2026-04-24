/**
 * 생체 인증 래퍼
 *
 * - 앱 진입 게이트 / 결재 승인-반려 / 관리자 민감 작업 공통 사용
 * - 기기가 생체를 지원하지 않으면 (또는 미등록이면) true 즉시 반환하여 흐름 차단 X
 *   → 중요 작업은 호출 측에서 추가로 서버 재인증(비번/OTP) 요구 가능
 *
 * 사용 예:
 *   const { authenticate } = useBiometric();
 *   if (await authenticate('이 결재를 승인합니다')) { await api.post(...); }
 */
import { useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export interface AuthenticateResult {
  success: boolean;
  /** 인증 건너뜀 (기기 미지원, 미등록) — 호출자가 대체 인증 판단 */
  skipped: boolean;
  error?: string;
}

export function useBiometric() {
  const canUseBiometric = useCallback(async (): Promise<boolean> => {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  }, []);

  const authenticate = useCallback(async (
    promptMessage: string,
    options: { fallbackToPasscode?: boolean } = {},
  ): Promise<AuthenticateResult> => {
    const usable = await canUseBiometric();
    if (!usable) {
      return { success: true, skipped: true };
    }
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: '취소',
        disableDeviceFallback: !options.fallbackToPasscode, // 기본: 생체만
        requireConfirmation: false,
      });
      if (res.success) return { success: true, skipped: false };
      return {
        success: false,
        skipped: false,
        error: ('error' in res ? res.error : undefined) ?? '인증이 취소되었습니다',
      };
    } catch (e: any) {
      return { success: false, skipped: false, error: e?.message || '인증 실패' };
    }
  }, [canUseBiometric]);

  return { authenticate, canUseBiometric };
}
