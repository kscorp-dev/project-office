/**
 * 민감 화면(결재 본문 / 메일 본문 / 메신저 룸 등)에서 스크린샷 차단.
 *
 * 동작:
 *   - Android: FLAG_SECURE 가 설정되어 스크린샷 / 화면녹화 / 작업 전환 시 thumbnail 모두 가려짐
 *   - iOS: 스크린샷 시 "스크린샷 알림" 만 가능 (시스템 차단은 제공 X)
 *     → 시스템이 화면 녹화 감지하면 검은 오버레이 등은 별도 처리 필요 (추후)
 *
 * 사용:
 *   useScreenCaptureBlock();         // 마운트되면 차단, 언마운트 시 복원
 *   useScreenCaptureBlock(false);    // 조건부로 비활성화
 *
 * 주의:
 *   - 여러 화면에서 동시에 활성화될 수 있음 — 라이브러리가 ref-count 처리
 *   - dev client / 시뮬레이터에서는 동작 X (실기기 빌드만)
 */
import { useEffect } from 'react';

// expo-screen-capture 는 native module 이라 Expo Go 에서 미존재.
// 안전하게 dynamic require + 실패 시 noop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ScreenCapture: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ScreenCapture = require('expo-screen-capture');
} catch { /* Expo Go 등 — noop */ }

export function useScreenCaptureBlock(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled || !ScreenCapture) return;

    let cancelled = false;
    let activated = false;

    (async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
        if (cancelled) {
          // 마운트 해제 후 활성화된 경우 즉시 해제
          await ScreenCapture.allowScreenCaptureAsync();
        } else {
          activated = true;
        }
      } catch (err) {
        // 환경에 따라 미지원 — 무시
        console.info('[screen-capture] 차단 미지원:', (err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (!activated) return;
      ScreenCapture.allowScreenCaptureAsync().catch(() => { /* noop */ });
    };
  }, [enabled]);
}
