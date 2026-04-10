import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useWebRTC, ChatMessage, SharedDocument } from '../hooks/useWebRTC';
import { useTTS } from '../hooks/useTTS';
import { useSpeakingDetection } from '../hooks/useSpeakingDetection';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import {
  Mic, MicOff, Video, VideoOff, Monitor, Phone,
  MessageSquare, Users, FileText, ChevronRight,
  Download, Trash2, Circle, Square, Send,
  Volume2, VolumeX, Wifi, WifiOff, X,
  Paperclip, FileUp, ZoomIn, ZoomOut, RotateCcw,
  FileImage, File, Maximize2,
} from 'lucide-react';

/* ═══════════════════════════════════
   타입 정의
   ═══════════════════════════════════ */
interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

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

interface ParticipantInfo {
  socketId: string;
  name: string;
  position?: string;
  isHost: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  stream?: MediaStream;
  isLocal: boolean;
}

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000/api';

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf') return FileText;
  return File;
}

/* ═══════════════════════════════════
   모바일 감지 훅
   ═══════════════════════════════════ */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

/* ═══════════════════════════════════
   참가자 비디오 카드
   ═══════════════════════════════════ */
function ParticipantVideo({
  participant,
  isSpeaking,
  size = 'normal',
  onClick,
}: {
  participant: ParticipantInfo;
  isSpeaking: boolean;
  size?: 'large' | 'normal' | 'small';
  onClick?: () => void;
}) {
  const { stream, name, position, isLocal, isHost, isMuted, isVideoOff } = participant;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const sizeClass =
    size === 'large' ? 'w-full h-full min-h-0'
    : size === 'small' ? 'w-24 h-24 flex-shrink-0'
    : 'aspect-video';

  const avatarSize =
    size === 'large' ? 'w-24 h-24 text-4xl'
    : size === 'small' ? 'w-10 h-10 text-base'
    : 'w-16 h-16 text-2xl';

  return (
    <div
      onClick={onClick}
      className={`relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center
        ${sizeClass}
        ${isSpeaking
          ? 'ring-[3px] ring-green-400 shadow-[0_0_20px_rgba(74,222,128,0.25)]'
          : 'ring-1 ring-gray-700/50'}
        transition-all duration-300
        ${onClick ? 'cursor-pointer active:scale-95' : ''}
      `}
    >
      {/* 발언 중 테두리 애니메이션 */}
      {isSpeaking && (
        <div className="absolute inset-0 rounded-2xl border-2 border-green-400/60 animate-pulse pointer-events-none z-10" />
      )}

      {/* 비디오 또는 아바타 */}
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
          <div
            className={`${avatarSize} rounded-full bg-gradient-to-br from-primary-400 to-primary-600
              flex items-center justify-center font-bold text-white
              ${isSpeaking ? 'ring-4 ring-green-400/50 animate-pulse' : ''}`}
          >
            {name[0]}
          </div>
          {size !== 'small' && (
            <p className="text-xs text-gray-400">
              {isVideoOff ? '카메라 꺼짐' : '연결 중...'}
            </p>
          )}
        </div>
      )}

      {/* 이름 + 직급 오버레이 */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent
          ${size === 'small' ? 'px-1.5 py-1' : 'px-3 py-2'}`}
      >
        <div className="flex items-center gap-1.5">
          {/* 마이크 상태 아이콘 */}
          {isMuted ? (
            <MicOff size={size === 'small' ? 10 : 13} className="text-red-400 flex-shrink-0" />
          ) : isSpeaking ? (
            <Mic size={size === 'small' ? 10 : 13} className="text-green-400 flex-shrink-0 animate-pulse" />
          ) : (
            <Mic size={size === 'small' ? 10 : 13} className="text-white/60 flex-shrink-0" />
          )}

          {/* 이름 + 직급 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span
                className={`${size === 'small' ? 'text-[9px]' : 'text-xs'} text-white font-semibold truncate`}
              >
                {name}
                {isLocal ? ' (나)' : ''}
              </span>
              {isHost && (
                <span
                  className={`${size === 'small' ? 'text-[7px] px-0.5' : 'text-[10px] px-1'} bg-yellow-500/80 text-white rounded flex-shrink-0`}
                >
                  주최
                </span>
              )}
            </div>
            {position && (
              <p className={`${size === 'small' ? 'text-[8px]' : 'text-[11px]'} text-gray-300/80 truncate`}>
                {position}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 발언 상태 배지 (normal/large만) */}
      {isSpeaking && size !== 'small' && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-green-500/90 text-white text-[10px] font-medium px-2 py-0.5 rounded-full z-20">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          발언중
        </div>
      )}

      {/* 비디오 꺼짐 표시 (small) */}
      {isVideoOff && size === 'small' && (
        <div className="absolute top-0.5 right-0.5">
          <VideoOff size={10} className="text-red-400" />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════
   회의록 패널
   ═══════════════════════════════════ */
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
            <p className="text-sm">음성 인식이 자동으로 시작됩니다</p>
            <p className="text-xs mt-1 text-gray-600">회의 내용이 실시간으로 기록됩니다</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`${entry.isFinal ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-primary-400">{entry.speaker}</span>
                <span className="text-[10px] text-gray-500">{formatTime(entry.timestamp)}</span>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed">
                {entry.text}
                {!entry.isFinal && (
                  <span className="inline-block w-1 h-4 bg-primary-400 animate-pulse ml-0.5 align-middle" />
                )}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   채팅 패널
   ═══════════════════════════════════ */
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
          messages.map((msg) => {
            const isMe = msg.userId === currentUserId;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="text-[10px] text-gray-400 mb-0.5">{msg.name}</span>}
                <div
                  className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm ${
                    isMe
                      ? 'bg-primary-500 text-white rounded-br-md'
                      : 'bg-gray-700 text-gray-200 rounded-bl-md'
                  }`}
                >
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
          onChange={(e) => setInput(e.target.value)}
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

/* ═══════════════════════════════════
   문서 뷰어 (확대/축소/핀치줌)
   ═══════════════════════════════════ */
function ZoomableViewer({
  doc,
  meetingId,
  accessToken,
  onClose,
}: {
  doc: SharedDocument;
  meetingId: string;
  accessToken: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const touchState = useRef({ startDist: 0, startScale: 1, startX: 0, startY: 0, lastTap: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const fileUrl = `${API_URL}/meeting/${meetingId}/documents/${doc.id}/file?token=${accessToken}`;
  const isImage = doc.mimeType.startsWith('image/');
  const isPdf = doc.mimeType === 'application/pdf';

  const zoomIn = () => setScale((s) => Math.min(5, s + 0.5));
  const zoomOut = () => setScale((s) => Math.max(0.25, s - 0.5));
  const resetZoom = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  /* 터치 이벤트 — 핀치줌 + 팬 + 더블탭 */
  const getTouchDist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      touchState.current.startDist = getTouchDist(e.touches);
      touchState.current.startScale = scale;
    } else if (e.touches.length === 1) {
      touchState.current.startX = e.touches[0].clientX - position.x;
      touchState.current.startY = e.touches[0].clientY - position.y;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = getTouchDist(e.touches);
      const newScale = touchState.current.startScale * (dist / touchState.current.startDist);
      setScale(Math.max(0.25, Math.min(5, newScale)));
    } else if (e.touches.length === 1 && scale > 1) {
      setPosition({
        x: e.touches[0].clientX - touchState.current.startX,
        y: e.touches[0].clientY - touchState.current.startY,
      });
    }
  };

  const onTouchEnd = () => {
    const now = Date.now();
    if (now - touchState.current.lastTap < 300) {
      if (scale > 1) resetZoom();
      else { setScale(2.5); setPosition({ x: 0, y: 0 }); }
    }
    touchState.current.lastTap = now;
  };

  /* 마우스 휠 줌 (데스크톱) */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale((s) => Math.max(0.25, Math.min(5, s + delta)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* 마우스 드래그 (데스크톱) */
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const onMouseUp = () => { isDragging.current = false; };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/80 border-b border-gray-700/50">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={16} className="text-primary-400 flex-shrink-0" />
          <span className="text-sm text-white font-medium truncate">{doc.fileName}</span>
          <span className="text-[10px] text-gray-400 flex-shrink-0">{formatFileSize(doc.fileSize)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-700" title="축소">
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-gray-400 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-700" title="확대">
            <ZoomIn size={16} />
          </button>
          <button onClick={resetZoom} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-700" title="원래 크기">
            <RotateCcw size={16} />
          </button>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-700"
            title="새 탭에서 열기"
          >
            <Maximize2 size={16} />
          </a>
          <a href={fileUrl} download={doc.fileName} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-700" title="다운로드">
            <Download size={16} />
          </a>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-700 ml-1" title="닫기">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 문서 내용 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: scale > 1 ? 'grab' : 'default', touchAction: 'none' }}
      >
        {isImage && (
          <img
            src={fileUrl}
            alt={doc.fileName}
            draggable={false}
            className="max-w-full max-h-full object-contain transition-transform duration-100"
            style={{ transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)` }}
          />
        )}
        {isPdf && (
          <iframe
            src={fileUrl}
            title={doc.fileName}
            className="w-full h-full border-0 bg-white"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%`, height: `${100 / scale}%` }}
          />
        )}
        {!isImage && !isPdf && (
          <div className="text-center text-gray-400 p-8">
            <File size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium text-white mb-1">{doc.fileName}</p>
            <p className="text-sm mb-4">{formatFileSize(doc.fileSize)}</p>
            <a
              href={fileUrl}
              download={doc.fileName}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors"
            >
              <Download size={16} /> 다운로드
            </a>
          </div>
        )}
      </div>

      {/* 모바일 줌 힌트 */}
      <div className="md:hidden text-center py-1 text-[10px] text-gray-500">
        두 손가락으로 확대/축소 · 더블탭으로 리셋
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   문서 공유 패널
   ═══════════════════════════════════ */
function DocumentPanel({
  documents,
  meetingId,
  accessToken,
  onUpload,
  onRemove,
  onView,
  uploading,
}: {
  documents: SharedDocument[];
  meetingId: string;
  accessToken: string;
  onUpload: (file: File) => void;
  onRemove: (docId: string) => void;
  onView: (doc: SharedDocument) => void;
  uploading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Paperclip size={16} className="text-primary-400" />
          <h3 className="text-sm font-semibold text-white">공유 문서</h3>
          {documents.length > 0 && (
            <span className="text-[10px] bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded-full">
              {documents.length}
            </span>
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 px-2.5 py-1 bg-primary-500 text-white text-xs rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
        >
          <FileUp size={12} />
          {uploading ? '업로드중...' : '파일 공유'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.hwp,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { onUpload(file); e.target.value = ''; }
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Paperclip size={32} className="mb-2 opacity-50" />
            <p className="text-sm">공유된 문서가 없습니다</p>
            <p className="text-xs mt-1 text-gray-600">파일을 업로드하여 참가자들과 공유하세요</p>
          </div>
        ) : (
          documents.map((doc) => {
            const Icon = getFileIcon(doc.mimeType);
            const canPreview = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf';
            return (
              <div
                key={doc.id}
                className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-700/50 group cursor-pointer transition-colors"
                onClick={() => onView(doc)}
              >
                <div className="w-9 h-9 rounded-lg bg-gray-700/80 flex items-center justify-center flex-shrink-0">
                  <Icon size={18} className="text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{doc.fileName}</p>
                  <p className="text-[10px] text-gray-400">
                    {doc.sharedBy} · {formatTime(doc.sharedAt)} · {formatFileSize(doc.fileSize)}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canPreview && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onView(doc); }}
                      className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-600"
                      title="미리보기"
                    >
                      <Maximize2 size={12} />
                    </button>
                  )}
                  <a
                    href={`${API_URL}/meeting/${meetingId}/documents/${doc.id}/file?token=${accessToken}`}
                    download={doc.fileName}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-600"
                    title="다운로드"
                  >
                    <Download size={12} />
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(doc.id); }}
                    className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-600"
                    title="삭제"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
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

  /* ── 반응형 ── */
  const isMobile = useIsMobile();

  /* ── 미디어 상태 ── */
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  /* ── UI 상태 ── */
  const [sidePanel, setSidePanel] = useState<'transcript' | 'chat' | 'participants' | 'documents' | null>(null);
  const [pinnedSpeaker, setPinnedSpeaker] = useState<string | null>(null);

  /* ── 회의록 ── */
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isSttActive, setIsSttActive] = useState(false);
  const recognitionRef = useRef<any>(null);
  const interimIdRef = useRef<string>('');
  const sttAutoStartedRef = useRef(false);

  /* ── 채팅 ── */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);

  /* ── 문서 공유 ── */
  const [sharedDocs, setSharedDocs] = useState<SharedDocument[]>([]);
  const [viewingDoc, setViewingDoc] = useState<SharedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [unreadDocs, setUnreadDocs] = useState(0);

  const userName = user?.name || '사용자';
  const userId = user?.id || '';
  const userPosition = user?.position || '';
  const accessToken = useAuthStore((s) => s.accessToken) || '';

  /* ── 발언 감지 ── */
  const { speakingIds, activeSpeaker, updateStream } = useSpeakingDetection();

  /* ── 오디오 녹음 ── */
  const audioRecorder = useMediaRecorder();

  /* ── TTS (참가자 입/퇴장 안내) ── */
  const tts = useTTS({ lang: 'ko-KR', rate: 1.1, volume: 0.7 });

  /* ── WebRTC 연결 ── */
  const {
    connected,
    remotePeers,
    sendMediaToggle,
    sendScreenShare,
    sendChat,
    sendTranscript,
    shareDocument: emitDocShared,
    removeDocument: emitDocRemoved,
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
      setChatMessages((prev) => [...prev, msg]);
      if (sidePanel !== 'chat') {
        setUnreadChat((prev) => prev + 1);
        if (msg.userId !== userId && msg.message.length <= 50) {
          tts.speak(`${msg.name}: ${msg.message}`);
        }
      }
    },
    onTranscript: (entry) => {
      if (entry.isFinal) {
        setTranscript((prev) => [
          ...prev,
          {
            id: entry.id,
            speaker: entry.speaker,
            text: entry.text,
            timestamp: new Date(entry.timestamp),
            isFinal: true,
          },
        ]);
      }
    },
    onDocumentShared: (doc) => {
      setSharedDocs((prev) => [...prev, doc]);
      if (sidePanel !== 'documents') setUnreadDocs((p) => p + 1);
      tts.speak(`${doc.sharedBy}님이 문서를 공유했습니다`);
    },
    onDocumentRemoved: (docId) => {
      setSharedDocs((prev) => prev.filter((d) => d.id !== docId));
    },
  });

  /* ── 카메라/마이크 초기화 ── */
  useEffect(() => {
    let stream: MediaStream | null = null;

    const initMedia = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setLocalStream(stream);
          setIsVideoOff(true);
        } catch {
          /* 마이크/카메라 없이도 참가 가능 */
        }
      }
    };

    initMedia();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /* ── 발언 감지: 스트림 등록 ── */
  useEffect(() => {
    updateStream('local', localStream);
  }, [localStream, updateStream]);

  useEffect(() => {
    remotePeers.forEach((p) => {
      updateStream(p.socketId, p.stream || null);
    });
  }, [remotePeers, updateStream]);

  /* ── 문서 목록 초기 로드 ── */
  useEffect(() => {
    if (!connected || !roomId || !accessToken) return;
    fetch(`${API_URL}/meeting/${roomId}/documents`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => { if (data.success) setSharedDocs(data.data); })
      .catch(() => {});
  }, [connected, roomId, accessToken]);

  /* ── 문서 업로드 ── */
  const handleDocUpload = useCallback(
    async (file: File) => {
      if (!roomId || !accessToken) return;
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${API_URL}/meeting/${roomId}/documents`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const data = await res.json();
        if (data.success) {
          setSharedDocs((prev) => [...prev, data.data]);
          emitDocShared(data.data); // 다른 참가자에게 알림
        } else {
          alert(data.error?.message || '업로드 실패');
        }
      } catch {
        alert('파일 업로드에 실패했습니다');
      } finally {
        setUploading(false);
      }
    },
    [roomId, accessToken, emitDocShared],
  );

  /* ── 문서 삭제 ── */
  const handleDocRemove = useCallback(
    async (docId: string) => {
      if (!roomId || !accessToken) return;
      if (!confirm('이 문서를 삭제하시겠습니까?')) return;
      try {
        const res = await fetch(`${API_URL}/meeting/${roomId}/documents/${docId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (data.success) {
          setSharedDocs((prev) => prev.filter((d) => d.id !== docId));
          emitDocRemoved(docId); // 다른 참가자에게 알림
        }
      } catch {
        /* ignore */
      }
    },
    [roomId, accessToken, emitDocRemoved],
  );

  /* ── 자동 녹음/회의록 시작 (기본 기능) ── */
  useEffect(() => {
    if (!connected || !localStream || sttAutoStartedRef.current) return;
    sttAutoStartedRef.current = true;

    // 음성 인식(STT) 자동 시작 — 2초 후 (카메라 안정화 대기)
    const sttTimer = setTimeout(() => {
      startRecognition();
    }, 2000);

    // 오디오 녹음 자동 시작
    const recordTimer = setTimeout(() => {
      const streams = [localStream];
      remotePeers.forEach((p) => {
        if (p.stream) streams.push(p.stream);
      });
      audioRecorder.startRecording(streams);
    }, 2500);

    return () => {
      clearTimeout(sttTimer);
      clearTimeout(recordTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, localStream]);

  /* ── 사이드 패널 토글 ── */
  const togglePanel = useCallback((panel: 'transcript' | 'chat' | 'participants' | 'documents') => {
    setSidePanel((prev) => {
      if (prev === panel) return null;
      if (panel === 'chat') setUnreadChat(0);
      if (panel === 'documents') setUnreadDocs(0);
      return panel;
    });
  }, []);

  /* ── 마이크 토글 ── */
  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
    }
    setIsMuted((prev) => {
      const next = !prev;
      sendMediaToggle(next, isVideoOff);
      return next;
    });
  }, [localStream, isVideoOff, sendMediaToggle]);

  /* ── 카메라 토글 ── */
  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
    }
    setIsVideoOff((prev) => {
      const next = !prev;
      sendMediaToggle(isMuted, next);
      return next;
    });
  }, [localStream, isMuted, sendMediaToggle]);

  /* ── 화면 공유 ── */
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch {
        /* ignore */
      }
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
          navigator.mediaDevices
            .getUserMedia({ video: true, audio: true })
            .then((s) => setLocalStream(s))
            .catch(() => {});
        };
      } catch {
        /* 화면 공유 실패 */
      }
    }
  }, [isScreenSharing, localStream, sendScreenShare]);

  /* ── 음성 인식 (Web Speech API) ── */
  const startRecognition = useCallback(() => {
    if (recognitionRef.current) return; // 이미 실행 중

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported');
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
          setTranscript((prev) => {
            const filtered = prev.filter((e) => e.id !== interimIdRef.current);
            return [
              ...filtered,
              {
                id: entryId,
                speaker: userName,
                text: text.trim(),
                timestamp: new Date(),
                isFinal: true,
              },
            ];
          });
          sendTranscript(text.trim(), true);
          interimIdRef.current = '';
        } else {
          if (!interimIdRef.current) {
            interimIdRef.current = `interim-${Date.now()}`;
          }
          const iid = interimIdRef.current;
          setTranscript((prev) => {
            const idx = prev.findIndex((e) => e.id === iid);
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
      if (event.error !== 'no-speech') {
        console.warn('Speech recognition error:', event.error);
        setIsSttActive(false);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current) {
        try {
          recognition.start();
        } catch {
          /* ignore */
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsSttActive(true);
    } catch (e) {
      console.warn('Failed to start speech recognition:', e);
    }
  }, [userName, sendTranscript]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsSttActive(false);
  }, []);

  const toggleStt = useCallback(() => {
    if (isSttActive) stopRecognition();
    else startRecognition();
  }, [isSttActive, startRecognition, stopRecognition]);

  /* ── 회의록 다운로드 ── */
  const downloadTranscript = useCallback(() => {
    const finalEntries = transcript.filter((e) => e.isFinal);
    if (finalEntries.length === 0) {
      alert('다운로드할 회의록이 없습니다.');
      return;
    }
    const lines = finalEntries.map((e) => {
      const time = e.timestamp.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
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
  const handleSendChat = useCallback(
    (message: string) => {
      sendChat(message);
    },
    [sendChat],
  );

  /* ── 통화 종료 ── */
  const handleLeave = useCallback(() => {
    if (recognitionRef.current) stopRecognition();
    if (audioRecorder.isRecording) audioRecorder.stopRecording();
    tts.stop();
    leaveWebRTC();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    navigate('/meeting');
  }, [localStream, navigate, stopRecognition, leaveWebRTC, tts, audioRecorder]);

  /* ── 모든 참가자 (로컬 + 원격) ── */
  const allParticipants: ParticipantInfo[] = [
    {
      socketId: 'local',
      name: userName,
      position: userPosition,
      isHost: true,
      isMuted,
      isVideoOff,
      stream: localStream || undefined,
      isLocal: true,
    },
    ...remotePeers.map((p) => ({
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

  /* ── 활성 발언자 (모바일) ── */
  const effectiveActiveSpeaker = pinnedSpeaker || activeSpeaker || 'local';
  const activeParticipant =
    allParticipants.find((p) => p.socketId === effectiveActiveSpeaker) || allParticipants[0];
  const otherParticipants = allParticipants.filter(
    (p) => p.socketId !== activeParticipant.socketId,
  );

  /* ── 비디오 그리드 (데스크톱) ── */
  const gridCols =
    totalParticipants <= 1
      ? 'grid-cols-1'
      : totalParticipants <= 4
        ? 'grid-cols-2'
        : totalParticipants <= 9
          ? 'grid-cols-3'
          : 'grid-cols-4';

  /* ── 녹음 경과 시간 ── */
  const recDuration = audioRecorder.formatDuration(audioRecorder.duration);

  /* ═══════════════════════════════════════
     상단 바 (공통)
     ═══════════════════════════════════════ */
  const TopBar = (
    <div className="flex items-center justify-between px-3 md:px-4 py-2 bg-gray-800/80 border-b border-gray-700/50">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <div className="w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <Video className="text-white" size={isMobile ? 12 : 14} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xs md:text-sm font-semibold text-white truncate">화상 회의</h1>
          {!isMobile && (
            <p className="text-[10px] text-gray-400">Room: {roomId || 'N/A'}</p>
          )}
        </div>

        {/* 연결 상태 */}
        <div
          className={`flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-full text-[10px] ${
            connected ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
          }`}
        >
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {!isMobile && (connected ? '연결됨' : '연결 중...')}
        </div>

        {/* 녹음 상태 */}
        {(isSttActive || audioRecorder.isRecording) && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px]">
            <Circle size={6} className="fill-red-400 animate-pulse" />
            {!isMobile && `REC ${recDuration}`}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 md:gap-2">
        {/* TTS 토글 */}
        <button
          onClick={() => tts.setEnabled(!tts.enabled)}
          className={`p-1.5 md:p-2 rounded-lg transition-colors ${
            tts.enabled ? 'text-primary-400 bg-primary-500/20' : 'text-gray-500 hover:bg-gray-700'
          }`}
          title={tts.enabled ? 'TTS 끄기' : 'TTS 켜기'}
        >
          {tts.enabled ? <Volume2 size={isMobile ? 14 : 16} /> : <VolumeX size={isMobile ? 14 : 16} />}
        </button>

        {/* 참가자 수 */}
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Users size={14} />
          {totalParticipants}/{16}
        </span>

        {!isMobile && (
          <>
            <button
              onClick={() => togglePanel('participants')}
              className={`p-2 rounded-lg transition-colors ${
                sidePanel === 'participants'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-gray-400 hover:bg-gray-700'
              }`}
            >
              <Users size={16} />
            </button>
            <button
              onClick={() => togglePanel('chat')}
              className={`relative p-2 rounded-lg transition-colors ${
                sidePanel === 'chat'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-gray-400 hover:bg-gray-700'
              }`}
            >
              <MessageSquare size={16} />
              {unreadChat > 0 && sidePanel !== 'chat' && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                  {unreadChat > 9 ? '9+' : unreadChat}
                </span>
              )}
            </button>
            <button
              onClick={() => togglePanel('documents')}
              className={`relative p-2 rounded-lg transition-colors ${
                sidePanel === 'documents'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-gray-400 hover:bg-gray-700'
              }`}
            >
              <Paperclip size={16} />
              {unreadDocs > 0 && sidePanel !== 'documents' && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 text-white text-[9px] rounded-full flex items-center justify-center">
                  {unreadDocs > 9 ? '9+' : unreadDocs}
                </span>
              )}
            </button>
            <button
              onClick={() => togglePanel('transcript')}
              className={`p-2 rounded-lg transition-colors ${
                sidePanel === 'transcript'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-gray-400 hover:bg-gray-700'
              }`}
            >
              <FileText size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  /* ═══════════════════════════════════════
     하단 컨트롤 바 (공통)
     ═══════════════════════════════════════ */
  const ControlBar = (
    <div className="flex items-center justify-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 bg-gray-800/80 border-t border-gray-700/50">
      {/* 마이크 */}
      <button
        onClick={toggleMute}
        className={`p-2.5 md:p-3 rounded-2xl transition-all ${
          isMuted ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-700 text-white hover:bg-gray-600'
        }`}
        title={isMuted ? '마이크 켜기' : '마이크 끄기'}
      >
        {isMuted ? <MicOff size={isMobile ? 18 : 20} /> : <Mic size={isMobile ? 18 : 20} />}
      </button>

      {/* 카메라 */}
      <button
        onClick={toggleVideo}
        className={`p-2.5 md:p-3 rounded-2xl transition-all ${
          isVideoOff ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-700 text-white hover:bg-gray-600'
        }`}
        title={isVideoOff ? '카메라 켜기' : '카메라 끄기'}
      >
        {isVideoOff ? <VideoOff size={isMobile ? 18 : 20} /> : <Video size={isMobile ? 18 : 20} />}
      </button>

      {/* 화면 공유 */}
      {!isMobile && (
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
      )}

      {/* 음성 인식 토글 */}
      <button
        onClick={toggleStt}
        className={`p-2.5 md:p-3 rounded-2xl transition-all ${
          isSttActive
            ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
            : 'bg-gray-700 text-white hover:bg-gray-600'
        }`}
        title={isSttActive ? '회의록 중지' : '회의록 시작'}
      >
        <FileText size={isMobile ? 18 : 20} />
      </button>

      {/* 모바일: 채팅/참가자/회의록 버튼 */}
      {isMobile && (
        <>
          <button
            onClick={() => togglePanel('chat')}
            className={`relative p-2.5 rounded-2xl transition-all ${
              sidePanel === 'chat' ? 'bg-primary-500/80 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'
            }`}
          >
            <MessageSquare size={18} />
            {unreadChat > 0 && sidePanel !== 'chat' && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                {unreadChat > 9 ? '9+' : unreadChat}
              </span>
            )}
          </button>
          <button
            onClick={() => togglePanel('documents')}
            className={`relative p-2.5 rounded-2xl transition-all ${
              sidePanel === 'documents' ? 'bg-primary-500/80 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'
            }`}
          >
            <Paperclip size={18} />
            {unreadDocs > 0 && sidePanel !== 'documents' && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 text-white text-[9px] rounded-full flex items-center justify-center">
                {unreadDocs > 9 ? '9+' : unreadDocs}
              </span>
            )}
          </button>
        </>
      )}

      {/* 녹음 다운로드 */}
      {audioRecorder.isRecording && (
        <button
          onClick={() => {
            audioRecorder.stopRecording();
            setTimeout(() => audioRecorder.downloadRecording(), 500);
          }}
          className="p-2.5 md:p-3 rounded-2xl bg-gray-700 text-orange-400 hover:bg-gray-600 transition-all"
          title="녹음 저장 및 종료"
        >
          <Download size={isMobile ? 18 : 20} />
        </button>
      )}

      {/* 구분선 */}
      <div className="w-px h-7 md:h-8 bg-gray-600 mx-0.5 md:mx-1" />

      {/* 나가기 */}
      <button
        onClick={handleLeave}
        className="p-2.5 md:p-3 rounded-2xl bg-red-600 text-white hover:bg-red-700 transition-all"
        title="회의 나가기"
      >
        <Phone size={isMobile ? 18 : 20} className="rotate-[135deg]" />
      </button>
    </div>
  );

  /* ═══════════════════════════════════════
     참가자 목록 패널 내용
     ═══════════════════════════════════════ */
  const ParticipantsContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">참가자 ({totalParticipants}/16)</h3>
        <button onClick={() => setSidePanel(null)} className="text-gray-400 hover:text-white">
          {isMobile ? <X size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {allParticipants.map((p) => {
          const speaking = speakingIds.has(p.socketId);
          return (
            <div
              key={p.socketId}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                speaking ? 'bg-green-500/10 ring-1 ring-green-500/30' : 'hover:bg-gray-700/50'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                  speaking ? 'ring-2 ring-green-400' : ''
                }`}
              >
                {p.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-white truncate">
                    {p.name}
                    {p.isLocal ? ' (나)' : ''}
                  </p>
                  {speaking && (
                    <span className="text-[9px] text-green-400 bg-green-400/10 px-1 rounded">발언중</span>
                  )}
                </div>
                {p.position && <p className="text-[10px] text-gray-400">{p.position}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {p.isMuted && <MicOff size={12} className="text-red-400" />}
                {p.isVideoOff && <VideoOff size={12} className="text-red-400" />}
                {p.isHost && <span className="text-[10px] text-yellow-400">주최</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ═══════════════════════════════════════
     모바일 레이아웃
     ═══════════════════════════════════════ */
  if (isMobile) {
    return (
      <div className="h-screen bg-gray-900 flex flex-col">
        {TopBar}

        {/* 메인 영역 */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* 활성 발언자 (크게) */}
          <div className="flex-1 p-2 min-h-0">
            <ParticipantVideo
              participant={activeParticipant}
              isSpeaking={speakingIds.has(activeParticipant.socketId)}
              size="large"
            />
          </div>

          {/* 다른 참가자 썸네일 스트립 */}
          {otherParticipants.length > 0 && (
            <div className="h-[100px] px-2 py-1.5 flex gap-2 overflow-x-auto bg-gray-800/50 border-t border-gray-700/30">
              {otherParticipants.map((p) => (
                <ParticipantVideo
                  key={p.socketId}
                  participant={p}
                  isSpeaking={speakingIds.has(p.socketId)}
                  size="small"
                  onClick={() =>
                    setPinnedSpeaker((prev) =>
                      prev === p.socketId ? null : p.socketId,
                    )
                  }
                />
              ))}
            </div>
          )}

          {/* 모바일 오버레이 패널 */}
          {sidePanel && (
            <div className="absolute inset-0 bg-gray-900/95 z-30 flex flex-col">
              <div className="flex-1 overflow-hidden">
                {sidePanel === 'participants' && ParticipantsContent}
                {sidePanel === 'chat' && (
                  <ChatPanel messages={chatMessages} onSend={handleSendChat} currentUserId={userId} />
                )}
                {sidePanel === 'transcript' && (
                  <TranscriptPanel
                    entries={transcript}
                    isRecording={isSttActive}
                    onToggleRecording={toggleStt}
                    onClear={clearTranscript}
                    onDownload={downloadTranscript}
                  />
                )}
                {sidePanel === 'documents' && (
                  <DocumentPanel
                    documents={sharedDocs}
                    meetingId={roomId || ''}
                    accessToken={accessToken}
                    onUpload={handleDocUpload}
                    onRemove={handleDocRemove}
                    onView={setViewingDoc}
                    uploading={uploading}
                  />
                )}
              </div>
              <button
                onClick={() => setSidePanel(null)}
                className="p-3 bg-gray-800 text-gray-400 hover:text-white text-sm border-t border-gray-700"
              >
                닫기
              </button>
            </div>
          )}
        </div>

        {ControlBar}

        {/* 문서 뷰어 오버레이 */}
        {viewingDoc && (
          <ZoomableViewer
            doc={viewingDoc}
            meetingId={roomId || ''}
            accessToken={accessToken}
            onClose={() => setViewingDoc(null)}
          />
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════
     데스크톱 레이아웃
     ═══════════════════════════════════════ */
  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      {TopBar}

      {/* 메인 영역 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 비디오 그리드 */}
        <div className="flex-1 p-4">
          <div className={`grid ${gridCols} gap-3 h-full auto-rows-fr`}>
            {allParticipants.map((p) => (
              <ParticipantVideo
                key={p.socketId}
                participant={p}
                isSpeaking={speakingIds.has(p.socketId)}
                size="normal"
              />
            ))}
          </div>
        </div>

        {/* 사이드 패널 */}
        {sidePanel && (
          <div className="w-80 bg-gray-800/50 border-l border-gray-700/50 flex flex-col">
            {sidePanel === 'participants' && ParticipantsContent}
            {sidePanel === 'chat' && (
              <ChatPanel messages={chatMessages} onSend={handleSendChat} currentUserId={userId} />
            )}
            {sidePanel === 'transcript' && (
              <TranscriptPanel
                entries={transcript}
                isRecording={isSttActive}
                onToggleRecording={toggleStt}
                onClear={clearTranscript}
                onDownload={downloadTranscript}
              />
            )}
            {sidePanel === 'documents' && (
              <DocumentPanel
                documents={sharedDocs}
                meetingId={roomId || ''}
                accessToken={accessToken}
                onUpload={handleDocUpload}
                onRemove={handleDocRemove}
                onView={setViewingDoc}
                uploading={uploading}
              />
            )}
          </div>
        )}
      </div>

      {ControlBar}

      {/* 문서 뷰어 오버레이 */}
      {viewingDoc && (
        <ZoomableViewer
          doc={viewingDoc}
          meetingId={roomId || ''}
          accessToken={accessToken}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </div>
  );
}
