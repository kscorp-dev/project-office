/**
 * CCTV 실시간 스트림 관리자 (LIVE-001)
 *
 * RTSP(카메라) → HLS(웹 브라우저) 변환을 FFmpeg child process로 수행.
 *
 * 프로세스 수명:
 *   1. 첫 뷰어가 /cameras/:id/stream/start 요청 → FFmpeg 시작
 *   2. FFmpeg는 uploads/cctv-streams/{cameraId}/{index.m3u8 + segN.ts}로 기록
 *   3. 뷰어는 /cameras/:id/stream/playlist.m3u8 또는 seg 다운로드
 *   4. 마지막 뷰어 접근 후 5분 idle → 자동 종료
 *
 * 안전장치:
 *   - 환경변수 CCTV_FFMPEG_PATH가 실제 존재해야 실행 (없으면 501 반환)
 *   - 카메라당 동시 뷰어 20명 제한 (기획 §3)
 *   - 프로세스 종료 시 HLS 디렉토리 정리
 *   - 서버 shutdown 시 모든 FFmpeg 자식 프로세스 SIGTERM
 *
 * 주의: 이것은 최소 구현이며 프로덕션에서는 `mediamtx` / `rtsp-simple-server` 같은
 *       전용 스트리밍 서버를 권장. 이 모듈은 소규모/내부용에 적합.
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../config/logger';
import { config } from '../config';

const STREAM_DIR = path.resolve(config.upload.dir, 'cctv-streams');
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_VIEWERS_PER_CAMERA = 20;
const FFMPEG_PATH = process.env.CCTV_FFMPEG_PATH || '';

interface StreamInstance {
  cameraId: string;
  process: ChildProcess;
  startedAt: number;
  viewers: Set<string>;
  lastAccessAt: number;
  idleTimer?: NodeJS.Timeout;
}

const instances = new Map<string, StreamInstance>();

export function isFfmpegAvailable(): boolean {
  return FFMPEG_PATH.trim().length > 0 && fs.existsSync(FFMPEG_PATH);
}

function streamDir(cameraId: string): string {
  return path.join(STREAM_DIR, cameraId);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function clearDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ }
  }
}

function scheduleIdleCheck(inst: StreamInstance): void {
  if (inst.idleTimer) clearTimeout(inst.idleTimer);
  inst.idleTimer = setTimeout(() => {
    const idleMs = Date.now() - inst.lastAccessAt;
    if (inst.viewers.size === 0 && idleMs >= IDLE_TIMEOUT_MS) {
      logger.info({ cameraId: inst.cameraId, idleMs }, '[cctv-stream] idle timeout — stopping');
      stopStream(inst.cameraId).catch(() => { /* ignore */ });
    } else {
      scheduleIdleCheck(inst);
    }
  }, IDLE_TIMEOUT_MS + 5000).unref();
}

/**
 * 스트림 시작 — 이미 실행 중이면 viewer만 추가
 * @returns playlist 상대 URL
 */
export async function startStream(params: {
  cameraId: string;
  rtspUrl: string;
  viewerId: string;
}): Promise<{ ok: true; playlistPath: string; viewerCount: number } | { ok: false; reason: string }> {
  if (!isFfmpegAvailable()) {
    return { ok: false, reason: 'FFMPEG_NOT_CONFIGURED' };
  }

  const existing = instances.get(params.cameraId);
  if (existing) {
    if (existing.viewers.size >= MAX_VIEWERS_PER_CAMERA && !existing.viewers.has(params.viewerId)) {
      return { ok: false, reason: 'MAX_VIEWERS_REACHED' };
    }
    existing.viewers.add(params.viewerId);
    existing.lastAccessAt = Date.now();
    return { ok: true, playlistPath: `cctv-streams/${params.cameraId}/index.m3u8`, viewerCount: existing.viewers.size };
  }

  const dir = streamDir(params.cameraId);
  ensureDir(dir);
  clearDir(dir);

  // FFmpeg: RTSP input → HLS output (재연결/저지연 옵션)
  const args = [
    '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-i', params.rtspUrl,
    '-c:v', 'copy',           // 재인코딩 없음 (CPU 절약, 원본 코덱 유지)
    '-c:a', 'aac',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+omit_endlist',
    '-hls_segment_filename', path.join(dir, 'seg%04d.ts'),
    path.join(dir, 'index.m3u8'),
  ];

  const proc = spawn(FFMPEG_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stderr?.on('data', (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) logger.debug({ cameraId: params.cameraId, ffmpeg: line.slice(0, 200) }, '[cctv-stream]');
  });

  proc.on('exit', (code, signal) => {
    logger.info({ cameraId: params.cameraId, code, signal }, '[cctv-stream] ffmpeg exit');
    const inst = instances.get(params.cameraId);
    if (inst && inst.process === proc) {
      if (inst.idleTimer) clearTimeout(inst.idleTimer);
      instances.delete(params.cameraId);
    }
    clearDir(dir);
  });

  const inst: StreamInstance = {
    cameraId: params.cameraId,
    process: proc,
    startedAt: Date.now(),
    viewers: new Set([params.viewerId]),
    lastAccessAt: Date.now(),
  };
  instances.set(params.cameraId, inst);
  scheduleIdleCheck(inst);

  logger.info({ cameraId: params.cameraId, pid: proc.pid }, '[cctv-stream] started');
  return { ok: true, playlistPath: `cctv-streams/${params.cameraId}/index.m3u8`, viewerCount: 1 };
}

/** viewer 제거 + 0명이면 유휴 타이머 시작 (즉시 종료 X — 재접속 대비) */
export function detachViewer(cameraId: string, viewerId: string): void {
  const inst = instances.get(cameraId);
  if (!inst) return;
  inst.viewers.delete(viewerId);
  inst.lastAccessAt = Date.now();
}

/** 명시적 중지 (관리자 요청 또는 idle) */
export async function stopStream(cameraId: string): Promise<void> {
  const inst = instances.get(cameraId);
  if (!inst) return;
  if (inst.idleTimer) clearTimeout(inst.idleTimer);
  instances.delete(cameraId);
  try {
    inst.process.kill('SIGTERM');
    setTimeout(() => {
      try { inst.process.kill('SIGKILL'); } catch { /* ignore */ }
    }, 3000).unref();
  } catch { /* ignore */ }
  clearDir(streamDir(cameraId));
}

/** 관리자용 — 현재 실행 중인 스트림 목록 */
export function listActiveStreams(): Array<{ cameraId: string; viewers: number; startedAt: number }> {
  return Array.from(instances.values()).map((i) => ({
    cameraId: i.cameraId,
    viewers: i.viewers.size,
    startedAt: i.startedAt,
  }));
}

/** shutdown 시 모든 프로세스 종료 */
export async function shutdownAllStreams(): Promise<void> {
  for (const id of Array.from(instances.keys())) {
    await stopStream(id);
  }
}

/** HLS 파일(세그먼트/playlist) 접근 시 lastAccessAt 갱신 */
export function touchStreamAccess(cameraId: string): void {
  const inst = instances.get(cameraId);
  if (inst) inst.lastAccessAt = Date.now();
}
