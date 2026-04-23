/**
 * 모바일 네이티브 캘린더 통합 (v0.18.0 Phase 3)
 *
 * iOS: EventKit (expo-calendar)
 * Android: CalendarContract (expo-calendar)
 *
 * ICS 구독(Phase 1) vs 네이티브 저장(Phase 3) 차이:
 *   - Phase 1: 서버 URL 구독 → 주기적 pull (iOS 기본 1시간)
 *   - Phase 3: 앱이 직접 기기 캘린더에 이벤트 저장 → 즉시 반영
 *
 * 사용법:
 *   const { saveEventToDevice } = useDeviceCalendar();
 *   await saveEventToDevice({ title, startDate, endDate, ... });
 *
 * 주의:
 *   - Expo Go에서는 제한적 동작 (EAS Build 권장)
 *   - 이미 저장된 이벤트와 중복 여부는 title+startDate로 근사 체크
 *   - 삭제/수정은 별도 지원 (externalId로 식별)
 */
import { useCallback, useMemo } from 'react';
import { Alert, Platform } from 'react-native';

// expo-calendar는 native module이라 Expo Go/웹에서 오류 가능 → 조건부 require
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Calendar: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Calendar = require('expo-calendar');
} catch { /* module 없으면 noop */ }

export interface DeviceEventInput {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay?: boolean;
  location?: string;
  notes?: string;
  /** 알림 (분 전). 복수 지원 */
  alarmsMinutes?: number[];
}

export function useDeviceCalendar() {
  const available = useMemo(() => !!Calendar, []);

  /** 로컬 기기 캘린더에 이벤트 저장 */
  const saveEventToDevice = useCallback(async (input: DeviceEventInput): Promise<string | null> => {
    if (!Calendar) {
      Alert.alert('기능 불가', '이 환경에서는 기기 캘린더에 직접 저장할 수 없습니다.');
      return null;
    }

    // 권한 요청
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '기기 캘린더 접근 권한이 필요합니다.');
      return null;
    }

    // 쓰기 가능한 기본 캘린더 찾기
    const calendars: Array<{
      id: string;
      title: string;
      isPrimary?: boolean;
      allowsModifications?: boolean;
      source?: { name?: string; type?: string };
    }> = await Calendar.getCalendarsAsync(Calendar.EntityTypes?.EVENT ?? 'event');

    // 수정 가능한 기본 캘린더 우선, 없으면 첫 번째 가능한 것
    const target =
      calendars.find((c) => c.allowsModifications && (c.isPrimary || c.source?.name === 'Default')) ||
      calendars.find((c) => c.allowsModifications);

    if (!target) {
      Alert.alert('캘린더 없음', '이 기기에 쓸 수 있는 캘린더가 없습니다.');
      return null;
    }

    try {
      const alarms = (input.alarmsMinutes ?? [10]).map((m) => ({
        relativeOffset: -m, // 음수 = 시작 전
        method: Calendar.AlarmMethod?.ALERT ?? 'alert',
      }));

      const eventId = await Calendar.createEventAsync(target.id, {
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        allDay: !!input.allDay,
        location: input.location,
        notes: input.notes,
        alarms,
      });

      Alert.alert('저장 완료', `"${input.title}"을(를) 기기 캘린더에 저장했습니다.`);
      return eventId;
    } catch (e: unknown) {
      const err = (e as Error).message || '저장 실패';
      Alert.alert('저장 실패', err);
      return null;
    }
  }, []);

  /** 여러 이벤트 일괄 저장 */
  const saveEventsToDevice = useCallback(async (inputs: DeviceEventInput[]): Promise<{ saved: number; failed: number }> => {
    if (!Calendar) return { saved: 0, failed: inputs.length };
    let saved = 0, failed = 0;
    for (const e of inputs) {
      const id = await saveEventToDevice(e).catch(() => null);
      if (id) saved += 1; else failed += 1;
    }
    return { saved, failed };
  }, [saveEventToDevice]);

  return {
    available,
    platform: Platform.OS,
    saveEventToDevice,
    saveEventsToDevice,
  };
}
