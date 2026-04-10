import { useEffect, useRef, useState, useCallback } from 'react';

const SPEAKING_THRESHOLD = 15;
const CHECK_INTERVAL_MS = 150;
const SPEAKING_HOLD_MS = 600; // 발언 종료 후에도 잠시 유지

/**
 * 오디오 레벨 분석을 통한 발언 감지 훅
 * - 여러 MediaStream(로컬+원격)의 오디오 레벨을 분석
 * - Web Audio API AnalyserNode 사용
 * - 발언 중인 참가자 ID Set과 현재 가장 큰 발언자 ID 반환
 */
export function useSpeakingDetection() {
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<
    Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; streamId: string }>
  >(new Map());
  const lastSpokeRef = useRef<Map<string, number>>(new Map());
  const activeSpeakerRef = useRef<string | null>(null);

  /** AudioContext 싱글턴 (suspended일 경우 resume) */
  const ensureContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, []);

  /**
   * 스트림 추가/제거/교체
   * @param id - 참가자 식별자 (socketId 또는 'local')
   * @param stream - MediaStream (null이면 제거)
   */
  const updateStream = useCallback(
    (id: string, stream: MediaStream | null | undefined) => {
      // 스트림 없으면 제거
      if (!stream) {
        const existing = analysersRef.current.get(id);
        if (existing) {
          try {
            existing.source.disconnect();
          } catch {
            /* ignore */
          }
          analysersRef.current.delete(id);
        }
        lastSpokeRef.current.delete(id);
        return;
      }

      // 동일 스트림이면 건너뜀
      const existing = analysersRef.current.get(id);
      if (existing && existing.streamId === stream.id) return;

      // 기존 analyser 정리
      if (existing) {
        try {
          existing.source.disconnect();
        } catch {
          /* ignore */
        }
      }

      // 새 analyser 생성
      try {
        const ctx = ensureContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        analysersRef.current.set(id, { analyser, source, streamId: stream.id });
      } catch (e) {
        console.warn('[SpeakingDetection] Error creating analyser for', id, e);
      }
    },
    [ensureContext],
  );

  /** 주기적 오디오 레벨 체크 */
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const currentSpeaking = new Set<string>();
      let loudest: { id: string; level: number } | null = null;

      analysersRef.current.forEach((entry, id) => {
        const data = new Uint8Array(entry.analyser.frequencyBinCount);
        entry.analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, val) => sum + val, 0) / data.length;

        if (avg > SPEAKING_THRESHOLD) {
          currentSpeaking.add(id);
          lastSpokeRef.current.set(id, now);
          if (!loudest || avg > loudest.level) {
            loudest = { id, level: avg };
          }
        } else {
          // 발언 종료 후 잠시 유지 (깜빡거림 방지)
          const lastSpoke = lastSpokeRef.current.get(id) || 0;
          if (now - lastSpoke < SPEAKING_HOLD_MS) {
            currentSpeaking.add(id);
          }
        }
      });

      // 변경 시에만 state 업데이트 (불필요한 리렌더 방지)
      setSpeakingIds((prev) => {
        if (prev.size !== currentSpeaking.size) return currentSpeaking;
        for (const id of currentSpeaking) {
          if (!prev.has(id)) return currentSpeaking;
        }
        for (const id of prev) {
          if (!currentSpeaking.has(id)) return currentSpeaking;
        }
        return prev;
      });

      // 가장 큰 발언자 추적
      if (loudest) {
        if (activeSpeakerRef.current !== loudest.id) {
          activeSpeakerRef.current = loudest.id;
          setActiveSpeaker(loudest.id);
        }
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      analysersRef.current.forEach((entry) => {
        try {
          entry.source.disconnect();
        } catch {
          /* ignore */
        }
      });
      analysersRef.current.clear();
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        ctxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return { speakingIds, activeSpeaker, updateStream };
}
