import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useWebRTC, ChatMessage } from '../hooks/useWebRTC';
import { useTTS } from '../hooks/useTTS';
import {
  Mic, MicOff, Video, VideoOff, Monitor, Phone,
  MessageSquare, Users, FileText, ChevronRight,
  Download, Trash2, Circle, Square, Send,
  Volume2, VolumeX, Wifi, WifiOff,
} from 'lucide-react';

/* ── 타입 ── */
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
function ParticipantVideo({
  stream,
  name,
  isLocal,
  isHost,
  isMuted,
  isVideoOff,
  isSpeaking,
}: {
  stream?: MediaStream;
  name: string;
  isLocal: boolean;
  isHost: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={`relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center aspect-video ${
      isSpeaking ? 'ring-2 ring-primary-400 ring-offset-2 ring-offset-gray-900' : 'ring-0'
    }`}>
      {stream && !isVideoOff ? (
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
            {name[0]}
          </div>
          <p className="text-xs text-gray-400">
            {isVideoOff ? '카메라 꺼짐' : '연결 중...'}
          </p>
        </div>
      )}

      {/* 이름 태그 */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
        {isMuted ? (
          <MicOff size={12} className="text-red-400" />
        ) : (
          <Mic size={12} className={isSpeaking ? 'text-primary-400' : 'text-white'} />
        )}
        <span className="text-xs text-white font-medium">
          {name}{isLocal ? ' (나)' : ''}
        </span>
        {isHost && (
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

/* ── 채팅 패널 ── */
function ChatPanel({
  messages,
  onSend,
  currentUserId,
}: {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
  currentUserId: string;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <MessageSquare size={16} className="text-primary-400" />
        <h3 className="text-sm font-semibold text-white">채팅</h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <MessageSquare size={32} className="mb-2 opacity-50" />
            <p className="text-sm">회의 중 채팅을 시작하세요</p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.userId === currentUserId;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && (
                  <span className="text-[10px] text-gray-400 mb-0.5">{msg.name}</span>
                )}
                <div className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm ${
                  isMe
                    ? 'bg-primary-500 text-white rounded-br-md'
                    : 'bg-gray-700 text-gray-200 rounded-bl-md'
                }`}>
                  {msg.message}
                </div>
                <span className="text-[10px] text-gray-500 mt-0.5">{formatTime(msg.timestamp)}</span>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="메시지 입력..."
          className="flex-1 bg-gray-700 text-white text-sm rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary-400 placeholder-gray-400"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="p-2 rounded-xl bg-primary-500 text-white disabled:opacity-40 hover:bg-primary-600 transition-colors"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════
   ██  메인 MeetingRoom 컴포넌트  ██
   ═══════════════════════════════════════ */
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
  const [sidePanel, setSidePanel] = useState<'transcript' | 'chat' | 'participants' | null>(null);

  // 회의록
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const interimIdRef = useRef<string>('');

  // 채팅
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);

  const userName = user?.name || '사용자';
  const userId = user?.id || '';

  // ── TTS (참가자 입/퇴장 안내) ──
  const tts = useTTS({ lang: 'ko-KR', rate: 1.1, volume: 0.7 });

  // ── WebRTC 연결 ──
  const {
    connected,
    remotePeers,
    sendMediaToggle,
    sendScreenShare,
    sendChat,
    sendTranscript,
    leave: leaveWebRTC,
  } = useWebRTC({
    meetingId: roomId || '',
    localStream,
    onPeerJoined: (peer) => {
      tts.speak(`${peer.name}님이 입장했습니다`);
    },
    onPeerLeft: (peer) => {
      tts.speak(`${peer.name}님이 퇴장했습니다`);
    },
    onChat: (msg) => {
      setChatMessages(prev => [...prev, msg]);
      if (sidePanel !== 'chat') {
        setUnreadChat(prev => prev + 1);
        // TTS로 채팅 읽기 (짧은 메시지만)
        if (msg.userId !== userId && msg.message.length <= 50) {
          tts.speak(`${msg.name}: ${msg.message}`);
        }
      }
    },
    onTranscript: (entry) => {
      if (entry.isFinal) {
        setTranscript(prev => [...prev, {
          id: entry.id,
          speaker: entry.speaker,
          text: entry.text,
          timestamp: new Date(entry.timestamp),
          isFinal: true,
        }]);
      }
    },
  });

  /* ── 카메라/마이크 초기화 ── */
  useEffect(() => {
    let stream: MediaStream | null = null;

    const initMedia = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch (err) {
        console.warn('미디어 접근 실패:', err);
        // 카메라/마이크 없이도 참가 가능
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setLocalStream(stream);
          setIsVideoOff(true);
        } catch {
          // 오디오도 없으면 빈 상태
        }
      }
    };

    initMedia();

    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  /* ── 사이드 패널 토글 ── */
  const togglePanel = useCallback((panel: 'transcript' | 'chat' | 'participants') => {
    setSidePanel(prev => {
      if (prev === panel) return null;
      if (panel === 'chat') setUnreadChat(0);
      return panel;
    });
  }, []);

  /* ── 마이크 토글 ── */
  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    }
    setIsMuted(prev => {
      const next = !prev;
      sendMediaToggle(next, isVideoOff);
      return next;
    });
  }, [localStream, isVideoOff, sendMediaToggle]);

  /* ── 카메라 토글 ── */
  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    }
    setIsVideoOff(prev => {
      const next = !prev;
      sendMediaToggle(isMuted, next);
      return next;
    });
  }, [localStream, isMuted, sendMediaToggle]);

  /* ── 화면 공유 ── */
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch { /* ignore */ }
      setIsScreenSharing(false);
      sendScreenShare(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setLocalStream(screen);
        setIsScreenSharing(true);
        sendScreenShare(true);
        screen.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          sendScreenShare(false);
          navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(s => setLocalStream(s))
            .catch(() => {});
        };
      } catch (err) {
        console.warn('화면 공유 실패:', err);
      }
    }
  }, [isScreenSharing, localStream, sendScreenShare]);

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
          const entryId = `t-${Date.now()}-${i}`;
          setTranscript(prev => {
            const filtered = prev.filter(e => e.id !== interimIdRef.current);
            return [...filtered, {
              id: entryId,
              speaker: userName,
              text: text.trim(),
              timestamp: new Date(),
              isFinal: true,
            }];
          });
          // 다른 참가자에게 회의록 전송
          sendTranscript(text.trim(), true);
          interimIdRef.current = '';
        } else {
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
      if (recognitionRef.current) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [userName, sendTranscript]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecognition();
    else startRecognition();
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

  /* ── 채팅 전송 ── */
  const handleSendChat = useCallback((message: string) => {
    sendChat(message);
    // 자신의 메시지도 로컬에 추가 (서버에서 브로드캐스트로 돌아옴)
  }, [sendChat]);

  /* ── 통화 종료 ── */
  const handleLeave = useCallback(() => {
    if (recognitionRef.current) stopRecognition();
    tts.stop();
    leaveWebRTC();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    navigate('/meeting');
  }, [localStream, navigate, stopRecognition, leaveWebRTC, tts]);

  /* ── 모든 참가자 (로컬 + 원격) ── */
  const allParticipants = [
    {
      socketId: 'local',
      name: userName,
      position: user?.position || '',
      isHost: true,
      isMuted,
      isVideoOff,
      stream: localStream || undefined,
      isLocal: true,
    },
    ...remotePeers.map(p => ({
      socketId: p.socketId,
      name: p.name,
      position: p.position,
      isHost: p.isHost,
      isMuted: p.isMuted,
      isVideoOff: p.isVideoOff,
      stream: p.stream,
      isLocal: false,
    })),
  ];

  const totalParticipants = allParticipants.length;

  /* ── 비디오 그리드 레이아웃 ── */
  const gridCols = totalParticipants <= 1 ? 'grid-cols-1'
    : totalParticipants <= 4 ? 'grid-cols-2'
    : totalParticipants <= 9 ? 'grid-cols-3'
    : 'grid-cols-4';

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
            <p className="text-[10px] text-gray-400">Room: {roomId || 'N/A'}</p>
          </div>
          {/* 연결 상태 표시 */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
            connected ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
          }`}>
            {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
            {connected ? '연결됨' : '연결 중...'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* TTS 토글 */}
          <button
            onClick={() => tts.setEnabled(!tts.enabled)}
            className={`p-2 rounded-lg transition-colors ${
              tts.enabled ? 'text-primary-400 bg-primary-500/20' : 'text-gray-500 hover:bg-gray-700'
            }`}
            title={tts.enabled ? 'TTS 끄기' : 'TTS 켜기'}
          >
            {tts.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Users size={14} />
            {totalParticipants}명
          </span>

          {/* 참가자 패널 */}
          <button
            onClick={() => togglePanel('participants')}
            className={`p-2 rounded-lg transition-colors ${
              sidePanel === 'participants' ? 'bg-primary-500/20 text-primary-400' : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <Users size={16} />
          </button>

          {/* 채팅 패널 */}
          <button
            onClick={() => togglePanel('chat')}
            className={`relative p-2 rounded-lg transition-colors ${
              sidePanel === 'chat' ? 'bg-primary-500/20 text-primary-400' : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <MessageSquare size={16} />
            {unreadChat > 0 && sidePanel !== 'chat' && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                {unreadChat > 9 ? '9+' : unreadChat}
              </span>
            )}
          </button>

          {/* 회의록 패널 */}
          <button
            onClick={() => togglePanel('transcript')}
            className={`p-2 rounded-lg transition-colors ${
              sidePanel === 'transcript' ? 'bg-primary-500/20 text-primary-400' : 'text-gray-400 hover:bg-gray-700'
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
            {allParticipants.map(p => (
              <ParticipantVideo
                key={p.socketId}
                stream={p.stream}
                name={p.name}
                isLocal={p.isLocal}
                isHost={p.isHost}
                isMuted={p.isMuted}
                isVideoOff={p.isVideoOff}
              />
            ))}
          </div>
        </div>

        {/* 사이드 패널 */}
        {sidePanel && (
          <div className="w-80 bg-gray-800/50 border-l border-gray-700/50 flex flex-col">
            {/* 참가자 목록 */}
            {sidePanel === 'participants' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                  <h3 className="text-sm font-semibold text-white">참가자 ({totalParticipants})</h3>
                  <button onClick={() => setSidePanel(null)} className="text-gray-400 hover:text-white">
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                  {allParticipants.map(p => (
                    <div key={p.socketId} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-700/50">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
                        {p.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {p.name}{p.isLocal ? ' (나)' : ''}
                        </p>
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

            {/* 채팅 */}
            {sidePanel === 'chat' && (
              <ChatPanel
                messages={chatMessages}
                onSend={handleSendChat}
                currentUserId={userId}
              />
            )}

            {/* 회의록 */}
            {sidePanel === 'transcript' && (
              <TranscriptPanel
                entries={transcript}
                isRecording={isRecording}
                onToggleRecording={toggleRecording}
                onClear={clearTranscript}
                onDownload={downloadTranscript}
              />
            )}
          </div>
        )}
      </div>

      {/* 하단 컨트롤 바 */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-gray-800/80 border-t border-gray-700/50">
        {/* 마이크 */}
        <button
          onClick={toggleMute}
          className={`p-3 rounded-2xl transition-all ${
            isMuted ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isMuted ? '마이크 켜기' : '마이크 끄기'}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* 카메라 */}
        <button
          onClick={toggleVideo}
          className={`p-3 rounded-2xl transition-all ${
            isVideoOff ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isVideoOff ? '카메라 켜기' : '카메라 끄기'}
        >
          {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
        </button>

        {/* 화면 공유 */}
        <button
          onClick={toggleScreenShare}
          className={`p-3 rounded-2xl transition-all ${
            isScreenSharing ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isScreenSharing ? '공유 중지' : '화면 공유'}
        >
          <Monitor size={20} />
        </button>

        {/* 음성 인식 토글 */}
        <button
          onClick={toggleRecording}
          className={`p-3 rounded-2xl transition-all ${
            isRecording ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse' : 'bg-gray-700 text-white hover:bg-gray-600'
          }`}
          title={isRecording ? '회의록 중지' : '회의록 시작 (음성인식)'}
        >
          <FileText size={20} />
        </button>

        {/* TTS */}
        <button
          onClick={() => tts.setEnabled(!tts.enabled)}
          className={`p-3 rounded-2xl transition-all ${
            tts.enabled ? 'bg-primary-500/80 text-white hover:bg-primary-600' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
          title={tts.enabled ? 'TTS 끄기 (음성 안내 비활성화)' : 'TTS 켜기 (음성 안내 활성화)'}
        >
          {tts.enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
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
