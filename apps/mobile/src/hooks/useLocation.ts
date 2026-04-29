/**
 * 위치 권한 + 1회 좌표 취득 훅 (출퇴근 GPS 인증용)
 *
 * - foreground 권한만 요청 (백그라운드는 추후)
 * - 정확도 'High' (출퇴근 인증은 ~10m 정확도 필요)
 * - 시간 초과 (12s) 시 lastKnown 으로 fallback
 *
 * 사용:
 *   const { getCurrentLocation } = useLocation();
 *   const loc = await getCurrentLocation();
 *   // loc = { latitude, longitude, accuracy, timestamp } 또는 throws
 */
import { useCallback } from 'react';
import * as Location from 'expo-location';

export interface CurrentLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
  /** lastKnown 으로 폴백한 경우 true */
  fromCache: boolean;
}

export class LocationError extends Error {
  code: 'PERMISSION_DENIED' | 'SERVICES_DISABLED' | 'TIMEOUT' | 'UNKNOWN';
  constructor(code: LocationError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function useLocation() {
  const ensurePermission = useCallback(async (): Promise<void> => {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) {
      throw new LocationError(
        'SERVICES_DISABLED',
        '기기의 위치 서비스가 꺼져 있습니다. 설정에서 켜주세요.',
      );
    }
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    if (existing === 'granted') return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new LocationError(
        'PERMISSION_DENIED',
        '위치 권한이 거부되었습니다. 출퇴근 인증을 위해 권한이 필요합니다.',
      );
    }
  }, []);

  const getCurrentLocation = useCallback(async (): Promise<CurrentLocation> => {
    await ensurePermission();
    try {
      // 12초 안에 정확한 좌표 못 받으면 lastKnown fallback
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      if (fresh) {
        return {
          latitude: fresh.coords.latitude,
          longitude: fresh.coords.longitude,
          accuracy: fresh.coords.accuracy ?? null,
          timestamp: fresh.timestamp,
          fromCache: false,
        };
      }
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
      if (last) {
        return {
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
          accuracy: last.coords.accuracy ?? null,
          timestamp: last.timestamp,
          fromCache: true,
        };
      }
      throw new LocationError('TIMEOUT', '위치 정보를 가져오는 데 실패했습니다. 다시 시도해주세요.');
    } catch (err) {
      if (err instanceof LocationError) throw err;
      throw new LocationError('UNKNOWN', (err as Error)?.message ?? '위치 조회 실패');
    }
  }, [ensurePermission]);

  return { getCurrentLocation, ensurePermission };
}
