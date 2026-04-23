/**
 * CCTV PTZ 제어 (PTZ-001~005)
 *
 * 제조사별 프로토콜이 다양하므로 어댑터 패턴으로 추상화:
 *   - 'stub': 아무것도 안 하고 성공 응답 (테스트/개발용)
 *   - 'onvif': ONVIF 표준 PTZ (실제 연동은 `onvif` npm 패키지 필요)
 *   - 'hikvision', 'dahua' 등: 제조사별 HTTP API
 *
 * 현재 구현은 stub만. 프로덕션에서는 onvif 어댑터 추가 필요.
 */
import type { Camera } from '@prisma/client';
import { logger } from '../config/logger';

export type PtzAction = 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'zoom-in' | 'zoom-out' | 'stop' | 'preset';

export interface PtzCommand {
  action: PtzAction;
  /** 속도(0~1) 또는 preset 번호 */
  value?: number;
  /** 제어 지속 시간(ms) — 일반적으로 stop 필요 없이 이 시간 후 자동 정지 */
  durationMs?: number;
}

export interface PtzAdapter {
  readonly name: string;
  execute(camera: Camera, command: PtzCommand): Promise<{ ok: boolean; message?: string }>;
}

/** Stub adapter — 개발/테스트. 실제 카메라와 통신하지 않음 */
const stubAdapter: PtzAdapter = {
  name: 'stub',
  async execute(camera, command) {
    logger.info(
      { cameraId: camera.id, command },
      '[cctv-ptz] STUB — command accepted but not sent to camera',
    );
    return { ok: true, message: 'stub mode — no actual command sent' };
  },
};

/** ONVIF adapter placeholder — 실제 사용 시 `onvif` npm 설치 필요 */
const onvifAdapter: PtzAdapter = {
  name: 'onvif',
  async execute(camera, command) {
    // TODO: import Cam from 'onvif';
    //       new Cam({ hostname, username, password, port }, cb)
    //       cam.continuousMove({ x: dx, y: dy, zoom: dz }, () => ... )
    logger.warn(
      { cameraId: camera.id, command },
      '[cctv-ptz] ONVIF adapter not implemented — install `onvif` package first',
    );
    return { ok: false, message: 'ONVIF adapter not yet implemented' };
  },
};

const ADAPTERS: Record<string, PtzAdapter> = {
  stub: stubAdapter,
  onvif: onvifAdapter,
};

export function getPtzAdapter(adapterName: string | null | undefined): PtzAdapter {
  const name = (adapterName || process.env.CCTV_PTZ_DEFAULT_ADAPTER || 'stub').toLowerCase();
  return ADAPTERS[name] || stubAdapter;
}

export async function executePtzCommand(
  camera: Camera,
  command: PtzCommand,
): Promise<{ ok: boolean; message?: string }> {
  if (!camera.isPtz) {
    return { ok: false, message: 'PTZ 지원하지 않는 카메라입니다' };
  }
  const adapter = getPtzAdapter(camera.ptzAdapter);
  return adapter.execute(camera, command);
}
