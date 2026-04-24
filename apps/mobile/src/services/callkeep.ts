/**
 * CallKit (iOS) / ConnectionService (Android) 통합 — Phase 2 PoC.
 *
 * 역할:
 *   - 앱 부팅 시 `setupCallKeep()` 으로 권한 요청 + 이벤트 리스너 등록
 *   - 서버로부터 VoIP push / 고우선 FCM 수신 시 `displayIncomingMeetingCall()` 호출
 *   - 사용자가 수락하면 `answerCall` 이벤트 → 딥링크로 /meeting/room/:id 이동
 *
 * 중요:
 *   - react-native-callkeep 은 네이티브 모듈 포함 → Expo Go 에서 동작 X.
 *     `expo-dev-client` + `expo prebuild` 후 dev build 에서만 실제 UI 동작함.
 *     JS 코드만으로는 안전하게 import 가능 (initSafe 에서 동적 require 처리).
 *   - 시뮬레이터에서는 잠금화면 UI 까지 재현되지 않음 (실기기 테스트 필요).
 */
import { router } from 'expo-router';
import { Platform } from 'react-native';

type CallKeepModule = typeof import('react-native-callkeep').default;

let CallKeep: CallKeepModule | null = null;
let ready = false;

// UUID → meetingId 매핑. answerCall 이벤트에서 원 meetingId 복원용
const uuidToMeeting = new Map<string, string>();

function safeLoadCallKeep(): CallKeepModule | null {
  if (CallKeep) return CallKeep;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CallKeep = require('react-native-callkeep').default as CallKeepModule;
    return CallKeep;
  } catch {
    // Expo Go / prebuild 안된 환경 — 네이티브 모듈 미존재
    return null;
  }
}

export async function setupCallKeep(): Promise<void> {
  if (ready) return;
  const ck = safeLoadCallKeep();
  if (!ck) {
    console.info('[CallKeep] 네이티브 모듈 미존재 — setup 건너뜀 (Expo Go 등)');
    return;
  }

  try {
    await ck.setup({
      ios: {
        appName: 'Project Office',
        supportsVideo: true,
        // maximumCallGroups: '1',
        // maximumCallsPerCallGroup: '1',
      },
      android: {
        alertTitle: '권한 필요',
        alertDescription:
          '화상회의 수신을 위해 전화 기능 권한이 필요합니다.',
        cancelButton: '취소',
        okButton: '확인',
        additionalPermissions: [],
        foregroundService: {
          channelId: 'com.kscorp.projectoffice.voip',
          channelName: 'Project Office 화상회의',
          notificationTitle: '통화 중',
        },
      },
    });

    ck.addEventListener('answerCall', ({ callUUID }: { callUUID: string }) => {
      const meetingId = uuidToMeeting.get(callUUID);
      uuidToMeeting.delete(callUUID);
      console.info('[CallKeep] answerCall', { callUUID, meetingId });
      if (meetingId) {
        router.push(`/meeting/${meetingId}` as any);
      }
    });

    ck.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => {
      uuidToMeeting.delete(callUUID);
      console.info('[CallKeep] endCall', { callUUID });
      // TODO: POST /meeting/:id/decline or leave
    });

    ck.addEventListener(
      'didPerformSetMutedCallAction',
      ({ muted, callUUID }: { muted: boolean; callUUID: string }) => {
        console.info('[CallKeep] mute', { muted, callUUID });
        // TODO: WebRTC peer connection 측 mute 반영
      },
    );

    ready = true;
    console.info('[CallKeep] setup 완료');
  } catch (err) {
    console.warn('[CallKeep] setup 실패:', err);
  }
}

/**
 * 초대 푸시 도착 시 호출. CallKit 잠금화면 UI를 즉시 표시한다.
 *
 * @param uuid     서버에서 발급한 UUID (VoIP payload 에 포함)
 * @param meetingId 앱 내 meeting id (answerCall 이벤트에서 딥링크용으로 사용)
 * @param callerName 표시될 발신자 이름
 * @param hasVideo 영상 통화 여부
 */
export function displayIncomingMeetingCall(
  uuid: string,
  meetingId: string,
  callerName: string,
  hasVideo: boolean = true,
): void {
  const ck = safeLoadCallKeep();
  if (!ck) {
    console.info('[CallKeep] 모듈 없음 — 인앱 알림으로 폴백 필요');
    return;
  }
  uuidToMeeting.set(uuid, meetingId);

  if (Platform.OS === 'ios') {
    ck.displayIncomingCall(uuid, callerName, callerName, 'generic', hasVideo);
  } else {
    ck.displayIncomingCall(uuid, callerName, callerName, 'generic', hasVideo);
  }
}

/** 발신자가 취소하거나 timeout 등으로 호출을 중단해야 할 때 */
export function endIncomingCall(uuid: string): void {
  const ck = safeLoadCallKeep();
  if (!ck) return;
  uuidToMeeting.delete(uuid);
  try {
    ck.endCall(uuid);
  } catch (err) {
    console.warn('[CallKeep] endCall 실패:', err);
  }
}

/**
 * PoC 전용: 개발 모드에서 수신 UI 를 로컬 트리거로 테스트.
 * displayIncomingCall 을 즉시 호출 → iOS 시뮬/실기기에서 CallKit UI 확인 가능.
 */
export function simulateIncomingCall(meetingId: string = 'demo-meeting-001'): string {
  const uuid = generateUUID();
  displayIncomingMeetingCall(uuid, meetingId, '김부장 (데모)', true);
  console.info('[CallKeep] 가짜 수신 트리거', { uuid, meetingId });
  return uuid;
}

function generateUUID(): string {
  // RFC 4122 v4 간이 구현 — CallKit 용 UUID 형식만 맞으면 됨
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
