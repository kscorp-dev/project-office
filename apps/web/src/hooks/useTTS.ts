import { useCallback, useEffect, useRef, useState } from 'react';

interface TTSOptions {
  lang?: string;       // 기본값: 'ko-KR'
  rate?: number;       // 0.1 ~ 10, 기본값: 1
  pitch?: number;      // 0 ~ 2, 기본값: 1
  volume?: number;     // 0 ~ 1, 기본값: 0.8
  enabled?: boolean;   // TTS 활성화 여부
}

interface UseTTSReturn {
  speak: (text: string) => void;
  stop: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setSelectedVoice: (v: SpeechSynthesisVoice | null) => void;
}

export function useTTS(options: TTSOptions = {}): UseTTSReturn {
  const {
    lang = 'ko-KR',
    rate = 1,
    pitch = 1,
    volume = 0.8,
    enabled: initialEnabled = true,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported] = useState(() => 'speechSynthesis' in window);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const queueRef = useRef<string[]>([]);
  const speakingRef = useRef(false);

  // 음성 목록 로드 (한 번만 실행)
  const voiceLoadedRef = useRef(false);
  useEffect(() => {
    if (!isSupported || voiceLoadedRef.current) return;

    const loadVoices = () => {
      const allVoices = speechSynthesis.getVoices();
      if (allVoices.length === 0) return; // 아직 로드 안 됨
      voiceLoadedRef.current = true;

      const koreanVoices = allVoices.filter(v => v.lang.startsWith('ko'));
      setVoices(allVoices);

      if (koreanVoices.length > 0) {
        const preferred = koreanVoices.find(v => v.name.includes('Google')) || koreanVoices[0];
        setSelectedVoice(preferred);
      }
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, [isSupported]);

  // 큐 처리
  const processQueue = useCallback(() => {
    if (!isSupported || !enabled || speakingRef.current || queueRef.current.length === 0) return;

    const text = queueRef.current.shift()!;
    speakingRef.current = true;
    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    if (selectedVoice) utterance.voice = selectedVoice;

    utterance.onend = () => {
      speakingRef.current = false;
      setIsSpeaking(false);
      // 다음 큐 처리
      processQueue();
    };

    utterance.onerror = (event) => {
      if (event.error !== 'canceled') {
        console.warn('[TTS] Error:', event.error);
      }
      speakingRef.current = false;
      setIsSpeaking(false);
      processQueue();
    };

    speechSynthesis.speak(utterance);
  }, [isSupported, enabled, lang, rate, pitch, volume, selectedVoice]);

  // speak 함수
  const speak = useCallback((text: string) => {
    if (!isSupported || !enabled || !text.trim()) return;
    queueRef.current.push(text.trim());
    processQueue();
  }, [isSupported, enabled, processQueue]);

  // stop 함수
  const stop = useCallback(() => {
    if (!isSupported) return;
    queueRef.current = [];
    speechSynthesis.cancel();
    speakingRef.current = false;
    setIsSpeaking(false);
  }, [isSupported]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (isSupported) {
        speechSynthesis.cancel();
      }
    };
  }, [isSupported]);

  return {
    speak,
    stop,
    isSpeaking,
    isSupported,
    enabled,
    setEnabled,
    voices,
    selectedVoice,
    setSelectedVoice,
  };
}
