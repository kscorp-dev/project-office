import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * 회의 오디오 녹음 훅
 * - 여러 MediaStream을 AudioContext로 믹싱하여 단일 녹음
 * - MediaRecorder API 사용 (audio/webm)
 * - 녹음 파일 다운로드 지원
 */
export function useMediaRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mixCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  /** 녹음 시작 — 여러 스트림의 오디오를 믹싱하여 녹음 */
  const startRecording = useCallback((streams: MediaStream[]) => {
    // 이미 녹음 중이면 무시
    if (recorderRef.current) return;
    if (streams.length === 0) return;

    try {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();

      const sources: MediaStreamAudioSourceNode[] = [];
      for (const stream of streams) {
        if (stream.getAudioTracks().length > 0) {
          const source = ctx.createMediaStreamSource(stream);
          source.connect(dest);
          sources.push(source);
        }
      }

      if (sources.length === 0) {
        ctx.close();
        return;
      }

      mixCtxRef.current = ctx;
      sourcesRef.current = sources;

      // MediaRecorder 생성
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(dest.stream, { mimeType });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000); // 1초 단위 수집
      recorderRef.current = recorder;
      setIsRecording(true);
      startTimeRef.current = Date.now();

      // 경과 시간 타이머
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (e) {
      console.warn('[MediaRecorder] Failed to start:', e);
    }
  }, []);

  /** 새 스트림 추가 (녹음 중에 새 참가자가 들어올 때) */
  const addStream = useCallback((stream: MediaStream) => {
    if (!mixCtxRef.current || !recorderRef.current) return;
    try {
      if (stream.getAudioTracks().length > 0) {
        const source = mixCtxRef.current.createMediaStreamSource(stream);
        // MediaStreamDestination의 stream은 dest를 통해 접근
        // 이미 생성된 dest에 연결
        const dest = mixCtxRef.current.destination;
        source.connect(dest);
        sourcesRef.current.push(source);
      }
    } catch (e) {
      console.warn('[MediaRecorder] Failed to add stream:', e);
    }
  }, []);

  /** 녹음 중지 */
  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;

    sourcesRef.current.forEach((s) => {
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    });
    sourcesRef.current = [];

    if (mixCtxRef.current) {
      mixCtxRef.current.close().catch(() => {});
      mixCtxRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setDuration(0);
  }, []);

  /** 녹음 파일 다운로드 (.webm) */
  const downloadRecording = useCallback((filename?: string) => {
    if (chunksRef.current.length === 0) {
      alert('다운로드할 녹음 파일이 없습니다.');
      return;
    }

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `회의녹음_${new Date().toISOString().slice(0, 10)}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /** 녹음 데이터 존재 여부 */
  const hasRecording = chunksRef.current.length > 0;

  /** 경과 시간 포맷 (MM:SS) */
  const formatDuration = useCallback((sec: number) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      sourcesRef.current.forEach((s) => {
        try {
          s.disconnect();
        } catch {
          /* ignore */
        }
      });
      if (mixCtxRef.current) {
        mixCtxRef.current.close().catch(() => {});
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    isRecording,
    duration,
    startRecording,
    addStream,
    stopRecording,
    downloadRecording,
    hasRecording,
    formatDuration,
  };
}
