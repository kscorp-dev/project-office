/**
 * 지오펜스 검증 — 사무실 좌표 + 허용 반경 기반.
 *
 * SystemSetting 에서 4개 키를 읽는다 (super_admin 만 변경 가능 — minRole 'super_admin'):
 *   - geofence_enabled : 'true' | 'false'  (기본 false)
 *   - office_lat       : 위도 (number)
 *   - office_lng       : 경도 (number)
 *   - office_radius_m  : 허용 반경 미터 (기본 200)
 *
 * 사용 예 (출퇴근 라우트):
 *   const result = await checkGeofence(req.body.latitude, req.body.longitude);
 *   // result.enabled  : 정책 적용 여부
 *   // result.distance : 사무실까지 거리 (m, 측정 가능 시)
 *   // result.inside   : 반경 내 여부 (boolean | undefined)
 */
import prisma from '../config/prisma';

const SETTING_KEYS = ['geofence_enabled', 'office_lat', 'office_lng', 'office_radius_m'] as const;

export interface GeofenceConfig {
  enabled: boolean;
  officeLat: number | null;
  officeLng: number | null;
  radiusM: number;
}

export interface GeofenceResult {
  /** 지오펜스 정책이 켜져 있는지 */
  enabled: boolean;
  /** 사무실 좌표가 등록되어 있는지 */
  configured: boolean;
  /** 거리 (미터). 클라이언트가 좌표 안 보냈거나 사무실 좌표 미등록 시 null */
  distanceM: number | null;
  /** 허용 반경 (미터) */
  radiusM: number;
  /** 반경 내 여부. distanceM 이 null 이면 undefined */
  inside: boolean | undefined;
}

/** 두 GPS 좌표 사이 거리 (Haversine, 미터) */
export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000; // 지구 반지름 m
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** SystemSetting 에서 지오펜스 설정 4개 동시 로드 */
export async function loadGeofenceConfig(): Promise<GeofenceConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: SETTING_KEYS as unknown as string[] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const officeLat = parseFloatOrNull(map.get('office_lat'));
  const officeLng = parseFloatOrNull(map.get('office_lng'));
  const radiusM = parseIntOrDefault(map.get('office_radius_m'), 200);
  const enabled = (map.get('geofence_enabled') ?? 'false').toLowerCase() === 'true';

  return { enabled, officeLat, officeLng, radiusM };
}

/**
 * 사용자가 보낸 좌표가 허용 반경 안인지 검증.
 * - 정책 비활성: enabled=false → inside=undefined (호출자는 통과 처리)
 * - 사무실 좌표 미등록: configured=false → inside=undefined
 * - 클라이언트가 좌표 안 보냄: distanceM=null + inside=undefined
 * - 정상: distanceM 비교 후 inside 반환
 */
export async function checkGeofence(
  userLat: number | null | undefined,
  userLng: number | null | undefined,
): Promise<GeofenceResult> {
  const cfg = await loadGeofenceConfig();
  const configured = cfg.officeLat !== null && cfg.officeLng !== null;

  if (
    typeof userLat !== 'number' || typeof userLng !== 'number' ||
    !configured
  ) {
    return {
      enabled: cfg.enabled,
      configured,
      distanceM: null,
      radiusM: cfg.radiusM,
      inside: undefined,
    };
  }

  const distanceM = haversineMeters(cfg.officeLat!, cfg.officeLng!, userLat, userLng);
  return {
    enabled: cfg.enabled,
    configured: true,
    distanceM,
    radiusM: cfg.radiusM,
    inside: distanceM <= cfg.radiusM,
  };
}

function parseFloatOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrDefault(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
