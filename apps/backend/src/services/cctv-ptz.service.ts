/**
 * CCTV PTZ 제어 (PTZ-001~005)
 *
 * 제조사별 프로토콜이 다양하므로 어댑터 패턴으로 추상화:
 *   - 'stub': 테스트/개발용 (실제 카메라 통신 없음)
 *   - 'onvif': ONVIF 표준 PTZ (v0.19.0에서 실구현 — onvif npm 사용)
 *   - 'hikvision', 'dahua': 향후 제조사별 HTTP API 확장 지점
 *
 * ONVIF 사용 시 Camera 레코드에:
 *   - rtspUrl: ONVIF device 호스트 추출에도 사용
 *   - ptzUsername / ptzPassword: ONVIF 인증 정보 (plain text or AES)
 *   - ptzAdapter = 'onvif'
 *
 * 접속 방법:
 *   new Cam({ hostname, username, password, port }, callback)
 *   .continuousMove({ x, y, zoom })
 *   .stop({ panTilt: true, zoom: true })
 *   .gotoPreset({ preset: '1' })
 */
import type { Camera } from '@prisma/client';
import { logger } from '../config/logger';
import { decryptMailPassword } from '../utils/mailCrypto';

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

/**
 * rtspUrl → ONVIF host/port 추출
 *   rtsp://user:pass@192.168.1.10:554/path → { hostname: 192.168.1.10, port: 80 }
 * ONVIF 서비스 기본 포트는 80. 카메라에 따라 8000/8899 등일 수 있어 환경변수 우선.
 */
function parseOnvifEndpoint(rtspUrl: string, overridePort?: number): { hostname: string; port: number } {
  try {
    const url = new URL(rtspUrl);
    return {
      hostname: url.hostname,
      port: overridePort ?? parseInt(process.env.ONVIF_DEFAULT_PORT || '80', 10),
    };
  } catch (err) {
    logger.warn({ err }, 'Internal error');
    return { hostname: 'localhost', port: 80 };
  }
}

/**
 * 저장된 PTZ 비밀번호 해석 — AES-256-GCM으로 암호화되어 있으면 복호화, 평문이면 그대로
 * (mailCrypto 포맷: iv:tag:ciphertext 각각 hex)
 */
function resolvePtzPassword(encryptedOrPlain: string | null): string | undefined {
  if (!encryptedOrPlain) return undefined;
  const isHexEncrypted = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(encryptedOrPlain);
  if (isHexEncrypted) {
    try {
      return decryptMailPassword(encryptedOrPlain);
    } catch (err) {
      logger.warn({ err }, 'Internal error');
      // 복호화 실패 시 평문으로 시도 (키가 바뀐 경우)
      return encryptedOrPlain;
    }
  }
  return encryptedOrPlain;
}

// onvif 패키지는 native 모듈이 아니지만 ESM 친화적이지 않아 동적 require
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
let _OnvifCam: any = null;
function getOnvifCamClass(): any {
  if (_OnvifCam) return _OnvifCam;
  try {
    _OnvifCam = require('onvif').Cam;
    return _OnvifCam;
  } catch (e) {
    logger.error({ err: (e as Error).message }, '[cctv-ptz] onvif module not available');
    return null;
  }
}
/* eslint-enable */

interface OnvifClient {
  continuousMove(params: { x: number; y: number; zoom: number }, cb: (err: Error | null) => void): void;
  stop(params: { panTilt?: boolean; zoom?: boolean }, cb: (err: Error | null) => void): void;
  gotoPreset?(params: { preset: string }, cb: (err: Error | null) => void): void;
}

function connectOnvif(camera: Camera): Promise<OnvifClient> {
  const Cam = getOnvifCamClass();
  if (!Cam) return Promise.reject(new Error('onvif 모듈이 설치되어 있지 않습니다'));

  const { hostname, port } = parseOnvifEndpoint(camera.rtspUrl);
  const username = camera.ptzUsername ?? 'admin';
  const password = resolvePtzPassword(camera.ptzPassword) ?? '';

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const device: any = new Cam(
      { hostname, port, username, password, timeout: 5000 },
      (err: Error | null) => {
        if (err) return reject(err);
        resolve(device as OnvifClient);
      },
    );
  });
}

/** 작업별 속도/축 계산 */
function actionToMove(action: PtzAction, speed: number): { x: number; y: number; zoom: number } {
  const s = Math.max(0.05, Math.min(1, speed));
  switch (action) {
    case 'pan-left':  return { x: -s, y: 0,   zoom: 0 };
    case 'pan-right': return { x:  s, y: 0,   zoom: 0 };
    case 'tilt-up':   return { x:  0, y:  s,  zoom: 0 };
    case 'tilt-down': return { x:  0, y: -s,  zoom: 0 };
    case 'zoom-in':   return { x:  0, y:  0,  zoom:  s };
    case 'zoom-out':  return { x:  0, y:  0,  zoom: -s };
    default:          return { x:  0, y:  0,  zoom:  0 };
  }
}

/** ONVIF 실구현 어댑터 */
const onvifAdapter: PtzAdapter = {
  name: 'onvif',
  async execute(camera, command) {
    try {
      const device = await connectOnvif(camera);
      const speed = command.value ?? 0.5;

      if (command.action === 'stop') {
        await new Promise<void>((resolve, reject) => {
          device.stop({ panTilt: true, zoom: true }, (err) => (err ? reject(err) : resolve()));
        });
        return { ok: true, message: 'stop OK' };
      }

      if (command.action === 'preset') {
        if (!device.gotoPreset) {
          return { ok: false, message: '이 카메라는 preset을 지원하지 않습니다' };
        }
        const presetId = command.value !== undefined ? String(command.value) : '1';
        await new Promise<void>((resolve, reject) => {
          device.gotoPreset!({ preset: presetId }, (err) => (err ? reject(err) : resolve()));
        });
        return { ok: true, message: `preset ${presetId} 이동` };
      }

      // continuousMove + 일정 시간 후 자동 stop
      const move = actionToMove(command.action, speed);
      await new Promise<void>((resolve, reject) => {
        device.continuousMove(move, (err) => (err ? reject(err) : resolve()));
      });

      const duration = command.durationMs ?? 500; // 기본 0.5초 짧은 nudge
      setTimeout(() => {
        device.stop({ panTilt: true, zoom: true }, (err) => {
          if (err) logger.warn({ err: err.message, cameraId: camera.id }, '[cctv-ptz] auto-stop failed');
        });
      }, Math.max(100, Math.min(10000, duration)));

      return { ok: true, message: `${command.action} 실행 (${duration}ms)` };
    } catch (e) {
      const msg = (e as Error).message || 'ONVIF 제어 실패';
      logger.warn({ err: msg, cameraId: camera.id, action: command.action }, '[cctv-ptz] onvif execute failed');
      return { ok: false, message: msg };
    }
  },
};

/** ONVIF 카메라 접속 테스트 — capabilities 조회로 credentials 검증 */
export async function testOnvifConnection(camera: Camera): Promise<{ ok: boolean; message: string }> {
  try {
    await connectOnvif(camera);
    return { ok: true, message: '접속 성공' };
  } catch (e) {
    return { ok: false, message: (e as Error).message || '접속 실패' };
  }
}

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
