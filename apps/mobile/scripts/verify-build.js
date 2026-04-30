#!/usr/bin/env node
/**
 * 모바일 dev build 정합성 자동 점검 스크립트.
 *
 * 실기기 EAS 빌드를 돌리기 전, 사람이 자주 빠뜨리는 항목 8가지를 빠르게 검사한다.
 * (실제 빌드는 시간/비용이 크므로 사전 게이트로 두는 게 합리적)
 *
 * 실행:
 *   node scripts/verify-build.js   (= npm run verify:build)
 *
 * 종료 코드:
 *   0 — 모두 PASS
 *   1 — 한 개 이상 FAIL (이유 출력)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fail = [];
const warn = [];

function check(label, ok, msg) {
  if (ok) {
    console.log(`✓ ${label}`);
  } else {
    fail.push(`✗ ${label} — ${msg}`);
  }
}

function checkWarn(label, ok, msg) {
  if (ok) {
    console.log(`✓ ${label}`);
  } else {
    warn.push(`! ${label} — ${msg}`);
  }
}

// ──────────────────────────────────────────────────────
// 1. app.json 필수 필드
// ──────────────────────────────────────────────────────
const appJsonPath = path.join(ROOT, 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const expo = appJson.expo;
check('app.json: name', !!expo.name, 'name 누락');
check('app.json: version', /^\d+\.\d+\.\d+$/.test(expo.version || ''), 'semver 형식이어야 함');
check('app.json: bundleIdentifier', !!expo.ios?.bundleIdentifier, 'iOS bundleIdentifier 누락');
check('app.json: android.package', !!expo.android?.package, 'Android package 누락');

// ──────────────────────────────────────────────────────
// 2. iOS UIBackgroundModes — CallKit 동작 필수
// ──────────────────────────────────────────────────────
const bgModes = expo.ios?.infoPlist?.UIBackgroundModes ?? [];
check('iOS UIBackgroundModes: voip', bgModes.includes('voip'), 'CallKit 작동 안 함');
check('iOS UIBackgroundModes: audio', bgModes.includes('audio'), '통화 중 음성 끊김');
check('iOS UIBackgroundModes: remote-notification',
  bgModes.includes('remote-notification'), '백그라운드 푸시 안 옴');

// ──────────────────────────────────────────────────────
// 3. iOS 권한 설명 — App Store 리젝션 방지
// ──────────────────────────────────────────────────────
const ip = expo.ios?.infoPlist ?? {};
check('iOS NSCameraUsageDescription', !!ip.NSCameraUsageDescription, '카메라 사용 설명 누락');
check('iOS NSMicrophoneUsageDescription', !!ip.NSMicrophoneUsageDescription, '마이크 설명 누락');
check('iOS NSLocationWhenInUseUsageDescription', !!ip.NSLocationWhenInUseUsageDescription, '위치 설명 누락');
check('iOS NSFaceIDUsageDescription', !!ip.NSFaceIDUsageDescription, 'Face ID 설명 누락');

// ──────────────────────────────────────────────────────
// 4. Android 권한 — CallKeep / WebRTC / 알림
// ──────────────────────────────────────────────────────
const perms = expo.android?.permissions ?? [];
const required = [
  'CAMERA', 'RECORD_AUDIO', 'POST_NOTIFICATIONS', 'WAKE_LOCK',
  'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_PHONE_CALL',
  'READ_PHONE_STATE', 'MANAGE_OWN_CALLS', 'BIND_TELECOM_CONNECTION_SERVICE',
];
for (const p of required) {
  check(`Android permission: ${p}`, perms.includes(p), `${p} 누락 — CallKeep 동작 X`);
}

// ──────────────────────────────────────────────────────
// 5. CallKeep / WebRTC config plugin
// ──────────────────────────────────────────────────────
const plugins = expo.plugins ?? [];
const pluginNames = plugins.map((p) => Array.isArray(p) ? p[0] : p);
check('plugins: @config-plugins/react-native-callkeep',
  pluginNames.includes('@config-plugins/react-native-callkeep'),
  'CallKit 네이티브 모듈 빌드 안 됨');
check('plugins: @config-plugins/react-native-webrtc',
  pluginNames.some((n) => n === '@config-plugins/react-native-webrtc'),
  'WebRTC 네이티브 모듈 빌드 안 됨');
check('plugins: expo-notifications', pluginNames.includes('expo-notifications'),
  'Expo Push 토큰 발급 안 됨');
check('plugins: with-aps-environment', pluginNames.includes('./plugins/with-aps-environment.js'),
  'APNs 환경 분기 플러그인 누락 — 프로덕션 푸시 silent fail 가능');

// ──────────────────────────────────────────────────────
// 6. eas.json 프로파일별 EXPO_PUBLIC_API_URL / APS_ENV
// ──────────────────────────────────────────────────────
const easJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
for (const profile of ['development', 'preview', 'production']) {
  const env = easJson.build?.[profile]?.env ?? {};
  check(`eas.json[${profile}].EXPO_PUBLIC_API_URL`, !!env.EXPO_PUBLIC_API_URL,
    `${profile} 빌드의 API URL 미설정`);
  check(`eas.json[${profile}].EXPO_PUBLIC_APS_ENV`, !!env.EXPO_PUBLIC_APS_ENV,
    `${profile} 빌드의 APNs 환경 미설정`);
}
checkWarn('eas.json[production].APS_ENV=production',
  easJson.build?.production?.env?.EXPO_PUBLIC_APS_ENV === 'production',
  '프로덕션 빌드 APS_ENV 가 production 이 아님 — App Store 배포 시 푸시 전송 실패');

// ──────────────────────────────────────────────────────
// 7. Notification Categories 코드 — usePushNotifications.ts
// ──────────────────────────────────────────────────────
const pushHookPath = path.join(ROOT, 'src/hooks/usePushNotifications.ts');
const pushHook = fs.readFileSync(pushHookPath, 'utf8');
check('usePushNotifications: approval category',
  pushHook.includes("setNotificationCategoryAsync?.('approval'"),
  '결재 인라인 [승인]/[반려] 미등록');
check('usePushNotifications: message category',
  pushHook.includes("setNotificationCategoryAsync?.('message'"),
  '메신저 인라인 [답장]/[읽음] 미등록');
check('usePushNotifications: meeting category',
  pushHook.includes("setNotificationCategoryAsync?.('meeting'"),
  '회의 인라인 [수락]/[거절] 미등록 — Step 4 누락');
check('usePushNotifications: displayIncomingMeetingCall',
  pushHook.includes('displayIncomingMeetingCall'),
  'CallKit 트리거 미연결');

// ──────────────────────────────────────────────────────
// 8. CallKeep 서비스
// ──────────────────────────────────────────────────────
const callkeepPath = path.join(ROOT, 'src/services/callkeep.ts');
check('callkeep.ts 존재', fs.existsSync(callkeepPath), 'callkeep 서비스 파일 없음');

// ──────────────────────────────────────────────────────
// 9. 스크린샷 차단 (Phase 3-B) — 민감 화면 3종에 적용
// ──────────────────────────────────────────────────────
const screenCaptureHook = path.join(ROOT, 'src/hooks/useScreenCaptureBlock.ts');
check('useScreenCaptureBlock 훅 존재', fs.existsSync(screenCaptureHook),
  '스크린샷 차단 훅 누락 — Phase 3-B 미적용');
const sensitiveScreens = [
  'app/approval/[id].tsx',
  'app/mail/[uid].tsx',
  'app/messenger/room/[id].tsx',
];
for (const rel of sensitiveScreens) {
  const filePath = path.join(ROOT, rel);
  if (!fs.existsSync(filePath)) {
    checkWarn(`screen-capture: ${rel}`, false, '파일 미존재');
    continue;
  }
  const src = fs.readFileSync(filePath, 'utf8');
  check(`screen-capture: ${rel}`,
    src.includes('useScreenCaptureBlock'),
    '민감 화면에 스크린샷 차단 미적용');
}

// ──────────────────────────────────────────────────────
// 10. 오프라인 캐시 (Phase 3-A) — offline-db 기본 구조
// ──────────────────────────────────────────────────────
const offlineDbIndex = path.join(ROOT, 'src/offline-db/index.ts');
check('offline-db: 초기화 모듈', fs.existsSync(offlineDbIndex),
  'SQLite 캐시 모듈 누락 — Phase 3-A 미적용');
const offlineDbSchema = path.join(ROOT, 'src/offline-db/schema.ts');
check('offline-db: drizzle 스키마', fs.existsSync(offlineDbSchema),
  'drizzle 스키마 파일 누락');

// ──────────────────────────────────────────────────────
// 결과
// ──────────────────────────────────────────────────────
console.log('');
if (warn.length > 0) {
  console.log('─── 경고 ───');
  warn.forEach((w) => console.log(w));
  console.log('');
}
if (fail.length > 0) {
  console.log('─── 실패 ───');
  fail.forEach((f) => console.log(f));
  console.log(`\n${fail.length} 항목 실패. 빌드 전에 수정하세요.`);
  process.exit(1);
}
console.log(`✅ 모든 점검 통과 (경고 ${warn.length}개) — EAS 빌드 진행 가능`);
