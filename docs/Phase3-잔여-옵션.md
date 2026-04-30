# Phase 3 잔여 옵션 항목 — 향후 진행 가이드

마지막 갱신: 2026-04-30 (v0.23.1)

기획 §11 Phase 3 5항목 중 v0.23.x 까지 미진행한 2개 옵션 항목 (모두 native iOS 작업).
운영 우선순위는 낮지만, 출시 후 보안/사용성 강화 단계에서 진행 가치 있음.

## 1. Widget (iOS) — 오늘의 결재 카운트

### 가치
- 홈 화면에서 앱 진입 없이 결재 대기 N건 / 새 메시지 N 확인
- iOS Widget 은 "사용자가 자주 보는 정보" 의 대표 표면 → engagement ↑

### 기술 선택
- **추천: `@bacons/widget-extension` config plugin**
  - EAS Build 기반 prebuild 시 native target 자동 추가
  - WidgetKit (iOS 14+) Swift 코드만 작성하면 됨
- 대안: `react-native-widgetkit` — 완성도 떨어짐, 별도 prebuild 필요
- Android Widget (RemoteViews) 은 별개 작업 — Phase 4

### 구현 단계 (예상 1-2일)
1. `npm install @bacons/widget-extension`
2. `app.json` plugins 에 widget extension 추가
3. `widget-extension/` 디렉토리에 Swift 코드 작성:
   - TimelineEntry: 결재 대기 수, 메시지 수, 알림 수
   - TimelineProvider: App Group 으로 메인 앱과 데이터 공유 (UserDefaults)
4. 메인 앱에서 `react-native-shared-group-preferences` 로 dashboard summary 를 App Group 에 push
5. Widget UI: SwiftUI ListWidget, 작은/중간/큰 3 사이즈
6. 빌드 검증 — verify-build.js 에 항목 추가

### 데이터 흐름
```
모바일 dashboard.tsx
  ├─ usePushNotifications (이미 fetch)
  └─ summary 데이터 도착 시 → SharedGroupPreferences 에 저장
                                    │
                                    ▼ App Group (com.kscorp.projectoffice.shared)
                                    │
Widget Extension (iOS)
  └─ TimelineProvider 가 30분마다 / 푸시 도착 시 SharedGroupPreferences 읽어 갱신
```

### 위험
- iOS Widget 갱신은 OS 정책 (Widget budget) 에 제한됨
- App Group 설정 누락 시 데이터 못 읽음 — entitlements 검증 필수
- App Store 제출 시 widget 별도 메타데이터 필요 (스크린샷, 설명)

---

## 2. App Attest / Play Integrity

### 가치
- 루팅/탈옥 기기에서 결재/관리자 액션 차단 (사내 컨플라이언스)
- API 호출이 정품 앱에서 왔는지 검증 — 서버 신뢰성 ↑
- 모바일 토큰 탈취 후 다른 기기에서 재사용 차단

### 기술 선택
- **iOS App Attest**: `expo-device-check` (커뮤니티 패키지) 또는 직접 Swift 모듈
- **Android Play Integrity**: `expo-play-integrity` — 공식 EAS plugin 부재, 직접 작성
- 백엔드: 토큰 검증 API (Apple/Google 공개 키로 attest 검증)

### 구현 단계 (예상 2-3일)
1. iOS:
   - DeviceCheck.framework 활성화 (entitlements)
   - 부팅 시 `DCAppAttestService.shared.generateKey()` 호출
   - 민감 작업 전 `attestKey()` → 서버에 전송
2. Android:
   - Play Integrity API 키 발급 (Google Play Console)
   - `IntegrityManager.requestIntegrityToken()` 호출
   - 서버에 nonce 전달
3. 백엔드:
   - `services/attestation.service.ts` — Apple/Google 키 검증 라이브러리
   - 결재/관리자 라우트 미들웨어 적용 — 토큰 없으면 403 ATTESTATION_REQUIRED
4. 정책:
   - 루팅 감지 시 결재/관리자 진입 차단 + 사용자 알림
   - 정상 기기 attest 결과 24h 캐시

### 위험
- Apple/Google attest 키 검증은 복잡 (JWT 검증 + 인증서 체인)
- iOS DeviceCheck 비트는 2비트만 사용 가능 — 정교한 정책 어려움
- Play Integrity 는 Google Play Services 미설치 기기(중국 등) 에서 작동 X
- 잘못된 구현 시 정상 사용자도 차단 가능 → 단계적 rollout 필요 (warn → enforce)

---

## 진행 결정 가이드

| 시나리오 | 추천 |
|---------|------|
| 사내 임직원만 사용, 보안 위협 낮음 | 둘 다 후순위 (Phase 4 이후) |
| 협력사/외부 사용자 포함 | App Attest 우선 |
| 임원/관리자 engagement 가 핵심 KPI | Widget 우선 |
| App Store 심사 통과만 목표 | 둘 다 불필요 |
| ISO 27001 / SOC2 준수 요구 | App Attest 필수 |

## 진행 시 사전 체크리스트

- [ ] EAS prebuild + dev client 빌드가 안정적으로 동작 (현재 v0.23.x 에서 verify-build 42/42 통과)
- [ ] iOS App Group 식별자 결정 (예: `group.com.kscorp.projectoffice`)
- [ ] App Store Connect 의 widget metadata 입력 권한 확보
- [ ] 백엔드 attest 검증 라이브러리 선정 (`@apple/app-attest-server` 또는 직접)
- [ ] 단계적 rollout 계획 (warn-only 1주 → enforce)

이 두 항목은 모두 native + 백엔드 검증 라이브러리가 필요해 1세션에 끝낼 작업이 아님.
v1.0 GA 출시 후 v1.1 / v1.2 단계로 분리해 진행 권장.
