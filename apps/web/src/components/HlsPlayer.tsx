/**
 * HLS 재생 컴포넌트 (CCTV 실시간 스트리밍용)
 *
 * 프로토콜:
 *   1) mount 시 POST /cctv/cameras/:cameraId/stream/start → playlistUrl 반환
 *   2) hls.js 로 playlistUrl 재생 (xhrSetup 으로 Bearer 토큰 주입)
 *   3) unmount 또는 cameraId 변경 시 POST /cctv/cameras/:cameraId/stream/stop
 *
 * 의존:
 *   - Safari 는 네이티브 HLS 지원 → <video src> 직접 세팅
 *   - 그 외 브라우저는 hls.js Mse 사용
 *
 * 에러 처리:
 *   - 서버 FFmpeg 미설정(501 FFMPEG_NOT_CONFIGURED) → 안내 문구 노출
 *   - viewer 한도 초과(429 MAX_VIEWERS_REACHED) → 안내
 *   - 권한 없음(403) → 안내
 */
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { MonitorPlay, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';

interface Props {
  cameraId: string;
  cameraName?: string;
  /** 추가 오버레이 (우측 하단 라벨 등) */
  overlay?: React.ReactNode;
  /** 전체 높이 채우기 — 기본 true */
  fill?: boolean;
}

interface State {
  status: 'starting' | 'playing' | 'error';
  code?: string;
  message?: string;
  playlistUrl?: string;
}

export default function HlsPlayer({ cameraId, cameraName, overlay, fill = true }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [state, setState] = useState<State>({ status: 'starting' });
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    let cancelled = false;
    let startedForCamera: string | null = null;

    (async () => {
      setState({ status: 'starting' });
      try {
        const res = await api.post(`/cctv/cameras/${cameraId}/stream/start`);
        if (cancelled) return;
        const playlistUrl = res.data?.data?.playlistUrl as string | undefined;
        if (!playlistUrl) {
          setState({ status: 'error', code: 'NO_URL', message: '플레이리스트 URL을 받지 못했습니다' });
          return;
        }
        startedForCamera = cameraId;

        const video = videoRef.current;
        if (!video) return;

        // Safari / iOS 는 HLS 네이티브 지원
        const canNative = video.canPlayType('application/vnd.apple.mpegurl');

        if (canNative) {
          // Bearer 토큰은 Authorization 헤더로만 수용하므로 native 는 인증 쿼리 문자열 우회 필요 →
          // 현재 서버는 쿠키 인증을 지원하지 않으므로 hls.js 경로를 우선 사용.
          // fallback 으로 native 지원도 시도.
        }

        if (Hls.isSupported()) {
          const hls = new Hls({
            lowLatencyMode: true,
            maxBufferLength: 10,
            // 모든 HLS 요청(m3u8, ts)에 Authorization 헤더 주입
            xhrSetup: (xhr) => {
              if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            },
          });
          hlsRef.current = hls;
          hls.loadSource(playlistUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => { /* autoplay 정책 — 사용자 제스처 필요 */ });
            setState({ status: 'playing', playlistUrl });
          });
          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (data.fatal) {
              setState({ status: 'error', code: 'HLS_FATAL', message: `${data.type}: ${data.details}` });
            }
          });
        } else if (canNative) {
          // hls.js 미지원 브라우저 — native 재생 시도 (인증 이슈 가능성)
          video.src = playlistUrl;
          video.addEventListener('loadedmetadata', () => {
            video.play().catch(() => { /* ignore */ });
            setState({ status: 'playing', playlistUrl });
          });
          video.addEventListener('error', () => {
            setState({ status: 'error', code: 'NATIVE_ERROR', message: '네이티브 HLS 재생 실패 (인증 제약)' });
          });
        } else {
          setState({ status: 'error', code: 'HLS_UNSUPPORTED', message: '이 브라우저는 HLS 재생을 지원하지 않습니다' });
        }
      } catch (err: any) {
        if (cancelled) return;
        const code = err.response?.data?.error?.code;
        const message = err.response?.data?.error?.message;
        setState({
          status: 'error',
          code: code ?? 'STREAM_START_FAILED',
          message: message ?? '스트리밍 시작 실패',
        });
      }
    })();

    return () => {
      cancelled = true;
      // 언마운트 시 HLS 파괴
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      // 서버에 viewer detach 알림 (best-effort, await 하지 않음)
      if (startedForCamera) {
        api.post(`/cctv/cameras/${startedForCamera}/stream/stop`).catch(() => { /* ignore */ });
      }
    };
    // accessToken 은 세션 유지 중엔 바뀌지 않으므로 cameraId 만 의존
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  const sizeCls = fill ? 'w-full h-full' : '';

  return (
    <div className={`relative bg-black rounded-2xl overflow-hidden ${sizeCls}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        muted
        playsInline
        controls={false}
      />

      {state.status === 'starting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 pointer-events-none">
          <MonitorPlay size={48} className="animate-pulse" />
          <span className="text-xs">스트리밍 시작 중...</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
          <AlertTriangle size={40} className="text-amber-400" />
          <p className="text-sm text-gray-200 font-medium">
            {state.code === 'FFMPEG_NOT_CONFIGURED'
              ? '서버에 FFmpeg가 설정되지 않았습니다'
              : state.code === 'MAX_VIEWERS_REACHED'
              ? '동시 시청자 수가 한도를 초과했습니다'
              : state.code === 'FORBIDDEN'
              ? '이 카메라에 접근 권한이 없습니다'
              : '스트리밍을 시작할 수 없습니다'}
          </p>
          {state.message && state.message !== state.code && (
            <p className="text-xs text-gray-500">{state.message}</p>
          )}
        </div>
      )}

      {cameraName && (
        <p className="absolute bottom-3 left-3 text-white/90 text-xs bg-black/50 px-2 py-1 rounded">
          {cameraName}
        </p>
      )}
      {overlay && <div className="absolute top-3 right-3">{overlay}</div>}

      {state.status === 'playing' && (
        <span className="absolute top-3 left-3 flex items-center gap-1 bg-red-500/80 text-white text-[10px] px-1.5 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          LIVE
        </span>
      )}
    </div>
  );
}
