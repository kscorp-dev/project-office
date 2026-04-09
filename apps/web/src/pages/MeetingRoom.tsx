import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import {
  Mic, MicOff, Video, VideoOff, Monitor, Phone,
  MessageSquare, Users, FileText, ChevronRight, ChevronLeft,
  Download, Trash2, Circle, Square, Settings,
} from 'lucide-react';

/* ── 타입 ── */
interface Participant {
  id: string;
  name: string;
  position?: string;
  isHost: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
  stream?: MediaStream;
}

interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

/* ── Web Speech API 타입 ── */
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

/* ── 참가자 비디오 카드 ── */
function ParticipantVideo({ participant, isLocal }: { participant: Participant; isLocal: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  return (
    <div className={`relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center aspect-video ${
      participant.isSpeaking ? 'ring-2 ring-primary-400 ring-offset-2 ring-offset-gray-900' : ''
    }`}>
      {participant.stream && !participant.isVideoOff ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-2xl font-bold text-white">
            {participant.name[0]}
          </div>
          {participant.isVideoOff && (
            <p className="text-xs text-gray-400">카메라 꺼짐</p>
          )}
        </div>
      )}

      {/* 이름 태그 */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
        {participant.isMuted ? (
          <MicOff size={12} className="text-red-400" />
        ) : (
          <Mic size={12} className={participant.isSpeaking ? 'text-primary-400' : 'text-white'} />
        )}
        <span className="text-xs text-white font-medium">
          {participant.name}{isLocal ? ' (나)' : ''}
        </span>
        {participant.isHost && (
          <span className="text-[10px] bg-yellow-500/80 text-white px-1 rounded">주최</span>
        )}
      </div>
    </div>
  );
}

/* ── 회의록 패널 ── */
function TranscriptPanel({
  entries,
  isRecording,
  onToggleRecording,
  onClear,
  onDownload,
}: {
  entries: TranscriptEntry[];
  isRecording: boolean;
  onToggleRecording: () => void;
  onClear: () => void;
  onDownload: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-primary-400" />
          <h3 className="text-sm font-semibold text-white">실시간 회의록</h3>
          {isRecording && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">
              <Circle size={6} className="fill-red-400 animate-pulse" />
              녹음중
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleRecording}
            className={`p-1.5 rounded-lg transition-colors ${
              isRecording
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
            }`}
            title={isRecording ? '인식 중지' : '음성 인식 시작'}
          >
            {isRecording ? <Square size={14} /> : <Mic size={14} />}
          </button>
          <button
            onClick={onDownload}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
            title="회의록 다운로드"
          >
            <Download size={14} />
          </button>
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-red-400 transition-colors"
            title="회의록 초기화"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 회의록 내용 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <FileText size={32} className="mb-2 opacity-50" />
            <p className="text-sm">음성 인식을 시작하면</p>
            <p className="text-sm">회의 내용이 자동으로 기록됩니다</p>
          </div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className={`${entry.isFinal ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-primary-400">{entry.speaker}</span>
                <span className="text-[10px] text-gray-500">{formatTime(entry.timestamp)}</span>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed">
                {entry.text}
                {!entry.isFinal && <span className="inline-block w-1 h-4 bg-primary-400 animate-pulse ml-0.5 align-middle" />}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── 메인 MeetingRoom ── */
export default function MeetingRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // 미디어 상태
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // UI 상태
  const [showTranscript, setShowTranscript] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);

  // 회의록
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const interimIdRef = useRef<string>('');

  // 참가자 (데모용 — 실제에서는 WebRTC signaling으로 관리)
  const [participants, setParticipants] = useState<Participant[]>([]);

  const userName = user?.name || '사용자';

  /* ── 카메라/마이크 초기화 ── */
  useEffect(() => {
    let stream: MediaStream | null = null;

    const initMedia = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch (err) {
        console.warn('미디어 접근 실패:', err);
        // 카메라/마이크 없어도 참가 가능
      }
    };

    initMedia();

    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  /* ── 참가자 목록 (데모) ── */
  useEffect(() => {
    const me: Participant = {
      id: user?.id || 'me',
      name: userName,
      position: user?.position || '',
      isHost: true,
      isMuted,
      isVideoOff,
      isSpeaking: false,
      stream: localStream || undefined,
    };

    const demoParticipants: Participant[] = [
      me,
      { id: 'd1', name: '김부장', position: '부장', isHost: false, isMuted: false, isVideoOff: false, isSpeaking: false },
      { id: 'd2', name: '이대리', position: '대리', isHost: false, isMuted: true, isVideoOff: false, isSpeaking: false },
      { id: 'd3', name: '박과장', position: '과장', isHost: false, isMuted: false, isVideoOff: true, isSpeaking: false },
    ];

    setParticipants(demoParticipants);
  }, [localStream, isMuted, isVideoOff, userName, user?.id, user?.position]);

  /* ── 마이크 토글 ── */
  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    }
    setIsMuted(prev => !prev);
  }, [localStream]);

  /* ── 카메라 토글 ── */
  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    }
    setIsVideoOff(prev => !prev);
  }, [localStream]);

  /* ── 화면 공유 ── */
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // 화면 공유 중지 → 카메라로 복귀
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch { /* ignore */ }
      setIsScreenSharing(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setLocalStream(screen);
        setIsScreenSharing(true);
        screen.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(s => setLocalStream(s))
            .catch(() => {});
        };
      } catch (err) {
        console.warn('화면 공유 실패:', err);
      }
    }
  }, [isScreenSharing, localStream]);

  /* ── 음성 인식 (Web Speech API) ── */
  const startRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 브라우저를 사용해주세요.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          // 확정된 텍스트
          const entryId = `t-${Date.now()}-${i}`;
          setTranscript(prev => {
            // interim 항목 제거 후 final 추가
            const filtered = prev.filter(e => e.id !== interimIdRef.current);
            return [...filtered, {
              id: entryId,
              speaker: userName,
              text: text.trim(),
              timestamp: new Date(),
              isFinal: true,
            }];
          });
          interimIdRef.current = '';
        } else {
          // 중간 결과
          if (!interimIdRef.current) {
            interimIdRef.current = `interim-${Date.now()}`;
          }
          const iid = interimIdRef.current;
          setTranscript(prev => {
            const idx = prev.findIndex(e => e.id === iid);
            const entry: TranscriptEntry = {
              id: iid,
              speaker: userName,
              text: text.trim(),
              timestamp: new Date(),
              isFinal: false,
            };
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = entry;
              return next;
            }
            return [...prev, entry];
          });
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        setIsRecording(false);
      }
    };

    recognition.onend = () => {
      // 자동 재시작 (녹음 중일 때)
      if (recognitionRef.current) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [userName]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecognition();
    } else {
      startRecognition();
    }
  }, [isRecording, startRecognition, stopRecognition]);

  /* ── 회의록 다운로드 ── */
  const downloadTranscript = useCallback(() => {
    const finalEntries = transcript.filter(e => e.isFinal);
    if (finalEntries.length === 0) {
      alert('다운로드할 회의록이 없습니다.');
      return;
    }
    const lines = finalEntries.map(e => {
      const time = e.timestamp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `[${time}] ${e.speaker}: ${e.text}`;
    });
    const header = `회의록 — ${new Date().toLocaleDateString('ko-KR')}\n회의 ID: ${roomId || 'N/A'}\n${'─'.repeat(40)}\n\n`;
    const blob = new Blob([header + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `회의록_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript, roomId]);

  const clearTranscript = useCallback(() => {
    if (transcript.length > 0 && confirm('회의록을 초기화하시겠습니까?')) {
      setTranscript([]);
    }
  }, [transcript]);

  /* ── 통화 종료 ── */
  const handleLeave = useCallback(() => {
    if (recognitionRef.current) stopRecognition();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    navigate('/meeting');
  }, [localStream, navigate, stopRecognition]);

  /* ── 비디오 그리드 레이아웃 ── */
  const gridCols = participants.length <= 1 ? 'grid-cols-1' :
                   participants.length <= 4 ? 'grid-cols-2' :
                   participants.length <= 9 ? 'grid-cols-3' : 'grid-cols-4';

  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800/80 border-b border-gray-700/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
            <Video className="text-white" size={14} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">화상 회의</h1>
            <p className="text-[10px] text-gray-400">Room: {roomId || 'demo'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Users size={14} />
            {participants.length}명 참석
          </span>
          <button
            onClick={() => setShowParticipants(!showParticipants)}
            className={`p-2 rounded-lg transition-colors ${
              showParticipants ? 'bg-primary-500/20 text-primary-400' : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <Users size={16} />
          </button>
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className={`p-2 rounded-lg transition-colors ${
              showTranscript ? 'bg-primary-500/20 text-primary-400' : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <FileText size={16} />
          </button>
        </div>
      </div>

      {/* 메인 영역 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 비디오 그리드 */}
        <div className="flex-1 p-4">
          <div className={`grid ${gridCols} gap-3 h-full auto-rows-fr`}>
            {participants.map((p, i) => (
              <ParticipantVideo
                key={p.id}
                participant={{
                  ...p,
                  stream: i === 0 ? localStream || undefined : undefined,
                }}
                isLocal={i === 0}
              />
            ))}
          </div>
        </div>

        {/* 참가자 목록 사이드 패널 */}
        {showParticipants && (
          <div className="w-64 bg-gray-800/50 border-l border-gray-700/50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-white">참가자 ({participants.length})</h3>
              <button onClick={() => setShowParticipants(false)} className="text-gray-400 hover:text-white">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
              {participants.map(p => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-700/50">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
                    {p.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{p.name}</p>
                    {p.position && <p className="text-[10px] text-gray-400">{p.position}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    {p.isMuted && <MicOff size={12} className="text-red-400" />}
                    {p.isVideoOff && <VideoOff size={12} className="text-red-400" />}
                    {p.isHost && <span className="text-[10px] text-yellow-400">주최</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 회의록 사이드 패널 */}
        {showTranscript && (
          <div className="w-80 bg-gray-800/50 border-l border-gray-700/50 flex flex-col">
            <TranscriptPanel
              entries={transcript}
              isRecording={isRecording}
              onToggleRecording={toggleRecording}
              onClear={clearTranscript}
              onDownload={downloadTranscript}
            />
          </div>
        )}
      </div>

      {/* 하단 컨트롤 바 */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-gray-800/80 border-t border-gray-700/50">
        {/* 마이크 */}
        <button
          onClick={toggleMute}
          className={`p-3 rounded-2xl transition-all ${
            isMuted
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isMuted ? '마이크 켜기' : '마이크 끄기'}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* 카메라 */}
        <button
          onClick={toggleVideo}
          className={`p-3 rounded-2xl transition-all ${
            isVideoOff
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isVideoOff ? '카메라 켜기' : '카메라 끄기'}
        >
          {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
        </button>

        {/* 화면 공유 */}
        <button
          onClick={toggleScreenShare}
          className={`p-3 rounded-2xl transition-all ${
            isScreenSharing
              ? 'bg-primary-500 text-white hover:bg-primary-600'
              : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isScreenSharing ? '공유 중지' : '화면 공유'}
        >
          <Monitor size={20} />
        </button>

        {/* 음성 인식 토글 */}
        <button
          onClick={toggleRecording}
          className={`p-3 rounded-2xl transition-all ${
            isRecording
              ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
              : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isRecording ? '회의록 중지' : '회의록 시작 (음성인식)'}
        >
          <FileText size={20} />
        </button>

        {/* 구분선 */}
        <div className="w-px h-8 bg-gray-600 mx-1" />

        {/* 나가기 */}
        <button
          onClick={handleLeave}
          className="p-3 rounded-2xl bg-red-600 text-white hover:bg-red-700 transition-all"
          title="회의 나가기"
        >
          <Phone size={20} className="rotate-[135deg]" />
        </button>
      </div>
    </div>
  );
}
