import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';
import { io, Socket } from 'socket.io-client';
import {
  MessageSquare, Send, Plus, Users, Search, Paperclip, X,
  FileText, Image as ImageIcon, Download, Eye, File,
} from 'lucide-react';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

interface Room {
  id: string;
  name?: string;
  type: string;
  unreadCount: number;
  lastMessage?: { content: string; createdAt: string; sender?: { name: string } };
  participants: { user: { id: string; name: string; profileImage?: string } }[];
}

interface FileMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  filePath: string;
}

interface Msg {
  id: string;
  content: string;
  type: string;
  metadata?: FileMetadata;
  createdAt: string;
  sender?: { id: string; name: string; profileImage?: string };
}

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return ImageIcon;
  if (['pdf'].includes(ext)) return FileText;
  return File;
}

export default function MessengerPage() {
  const { user, accessToken } = useAuthStore();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileMetadata | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Socket 연결
  useEffect(() => {
    if (!accessToken) return;

    const s = io(`${SOCKET_URL}/messenger`, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    s.on('connect', () => console.log('Messenger connected'));

    s.on('message:new', (msg: Msg) => {
      setMessages(prev => {
        // 중복 방지 (파일 업로드 시 REST + Socket 모두 메시지를 추가할 수 있음)
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      fetchRooms();
    });

    s.on('typing:start', ({ userId }: { userId: string }) => {
      setTyping(prev => [...new Set([...prev, userId])]);
    });

    s.on('typing:stop', ({ userId }: { userId: string }) => {
      setTyping(prev => prev.filter(id => id !== userId));
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, [accessToken]);

  useEffect(() => { fetchRooms(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const fetchRooms = async () => {
    try {
      const { data } = await api.get('/messenger/rooms');
      setRooms(data.data || []);
    } catch {}
  };

  const selectRoom = async (roomId: string) => {
    setSelectedRoom(roomId);
    try {
      const { data } = await api.get(`/messenger/rooms/${roomId}/messages`);
      setMessages(data.data || []);
      socket?.emit('message:read', { roomId });
    } catch {}
  };

  const sendMessage = () => {
    if (!input.trim() || !selectedRoom || !socket) return;

    socket.emit('message:send', {
      roomId: selectedRoom,
      content: input.trim(),
      type: 'text',
    });

    socket.emit('typing:stop', { roomId: selectedRoom });
    setInput('');
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (selectedRoom && socket) {
      socket.emit(value ? 'typing:start' : 'typing:stop', { roomId: selectedRoom });
    }
  };

  const createDirectChat = async (targetUserId: string) => {
    try {
      const { data } = await api.post('/messenger/rooms', {
        type: 'direct',
        participantIds: [targetUserId],
      });
      setShowNewChat(false);
      fetchRooms();
      selectRoom(data.data.id);
    } catch {}
  };

  const uploadFile = useCallback(async (file: globalThis.File) => {
    if (!selectedRoom || uploading) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(`/messenger/rooms/${selectedRoom}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Add locally (socket broadcast from backend will handle other participants)
      setMessages(prev => [...prev, data.data]);
      fetchRooms();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '파일 업로드 실패');
    } finally {
      setUploading(false);
    }
  }, [selectedRoom, uploading]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const isImageFile = (meta?: FileMetadata) => {
    if (!meta) return false;
    return meta.mimeType?.startsWith('image/');
  };

  const isPdfFile = (meta?: FileMetadata) => {
    if (!meta) return false;
    return meta.mimeType === 'application/pdf';
  };

  const getFileUrl = (meta?: FileMetadata) => {
    if (!meta?.filePath) return '';
    // dev: Vite proxy handles /uploads, prod: nginx proxies to backend
    return meta.filePath;
  };

  const getRoomDisplayName = (room: Room): string => {
    if (room.name) return room.name;
    if (room.type === 'direct') {
      const other = room.participants.find(p => p.user.id !== user?.id);
      return other?.user.name || '알 수 없음';
    }
    return room.participants.map(p => p.user.name).join(', ');
  };

  return (
    <div className="flex h-full">
      {/* Room List */}
      <div className="w-80 border-r dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col">
        <div className="p-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-lg dark:text-white">메신저</h2>
          <button onClick={() => setShowNewChat(true)} className="p-2 hover:bg-primary-50/50 dark:hover:bg-slate-700 rounded-2xl dark:text-gray-300">
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {rooms.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
              채팅방이 없습니다
            </div>
          ) : (
            rooms.map(room => (
              <button
                key={room.id}
                onClick={() => selectRoom(room.id)}
                className={`w-full flex items-center gap-3 p-3 hover:bg-primary-50/50 dark:hover:bg-slate-800 transition-colors border-b dark:border-slate-700 ${
                  selectedRoom === room.id ? 'bg-primary-50 dark:bg-slate-800' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {room.type === 'group' ? <Users size={18} /> : getRoomDisplayName(room)[0]}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate dark:text-white">{getRoomDisplayName(room)}</p>
                    {room.lastMessage && (
                      <span className="text-xs text-gray-400">
                        {new Date(room.lastMessage.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400 truncate">
                      {room.lastMessage
                        ? room.lastMessage.type === 'image' ? '📷 사진'
                          : room.lastMessage.type === 'file' ? '📎 파일'
                          : room.lastMessage.content
                        : '메시지가 없습니다'}
                    </p>
                    {room.unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                        {room.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-primary-50/50 dark:bg-slate-950">
        {selectedRoom ? (
          <>
            {/* Chat Header */}
            <div className="p-4 bg-white dark:bg-slate-900 border-b dark:border-slate-700">
              <h3 className="font-semibold dark:text-white">
                {getRoomDisplayName(rooms.find(r => r.id === selectedRoom)!)}
              </h3>
              {typing.length > 0 && (
                <p className="text-xs text-primary-500 mt-0.5">입력 중...</p>
              )}
            </div>

            {/* Messages */}
            <div
              className={`flex-1 overflow-auto p-4 space-y-3 relative ${dragOver ? 'ring-2 ring-primary-400 ring-inset bg-primary-50/80' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {dragOver && (
                <div className="absolute inset-0 flex items-center justify-center bg-primary-50/90 z-10 pointer-events-none">
                  <div className="text-center">
                    <Paperclip size={40} className="mx-auto mb-2 text-primary-500" />
                    <p className="text-primary-600 font-medium">파일을 여기에 놓으세요</p>
                  </div>
                </div>
              )}
              {messages.map(msg => {
                const isMe = msg.sender?.id === user?.id;
                const meta = msg.metadata as FileMetadata | undefined;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] ${isMe ? 'order-2' : ''}`}>
                      {!isMe && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 ml-1">{msg.sender?.name}</p>
                      )}

                      {/* 이미지 메시지 */}
                      {msg.type === 'image' && meta ? (
                        <div className="cursor-pointer" onClick={() => setPreviewFile(meta)}>
                          <img
                            src={getFileUrl(meta)}
                            alt={meta.fileName}
                            className="max-w-xs max-h-60 rounded-2xl object-cover shadow-sm hover:opacity-90 transition-opacity"
                          />
                          <p className={`text-xs text-gray-400 mt-0.5 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>
                            {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      ) : msg.type === 'file' && meta ? (
                        /* 파일 메시지 */
                        <div className={`px-3 py-2.5 rounded-2xl ${
                          isMe ? 'bg-primary-600 text-white rounded-br-md' : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm'
                        }`}>
                          <div className="flex items-center gap-2.5">
                            {(() => { const Icon = getFileIcon(meta.fileName); return <Icon size={28} className={isMe ? 'text-white/80' : 'text-primary-500'} />; })()}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{meta.fileName}</p>
                              <p className={`text-xs ${isMe ? 'text-white/70' : 'text-gray-400'}`}>
                                {formatFileSize(meta.fileSize)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              {isPdfFile(meta) && (
                                <button
                                  onClick={() => setPreviewFile(meta)}
                                  className={`p-1.5 rounded-lg ${isMe ? 'hover:bg-white/20' : 'hover:bg-gray-100 dark:hover:bg-slate-700'}`}
                                  title="미리보기"
                                >
                                  <Eye size={16} />
                                </button>
                              )}
                              <a
                                href={getFileUrl(meta)}
                                download={meta.fileName}
                                className={`p-1.5 rounded-lg ${isMe ? 'hover:bg-white/20' : 'hover:bg-gray-100 dark:hover:bg-slate-700'}`}
                                title="다운로드"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Download size={16} />
                              </a>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* 텍스트 메시지 */
                        <div className={`px-3 py-2 rounded-2xl ${
                          isMe ? 'bg-primary-600 text-white rounded-br-md' : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      )}

                      {msg.type !== 'image' && (
                        <p className={`text-xs text-gray-400 mt-0.5 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t dark:border-slate-700">
              {uploading && (
                <div className="mb-2 flex items-center gap-2 text-sm text-primary-600">
                  <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                  파일 업로드 중...
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.hwp,.csv,.zip,.mp4,.mp3"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="p-2.5 rounded-2xl hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-50"
                  title="파일 첨부"
                >
                  <Paperclip size={20} />
                </button>
                <input
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                  placeholder="메시지를 입력하세요..."
                  className="input-field flex-1"
                />
                <button onClick={sendMessage} disabled={!input.trim()} className="btn-primary px-4">
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageSquare size={64} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg">채팅방을 선택하세요</p>
            </div>
          </div>
        )}
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreviewFile(null)}>
          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-black/50 rounded-t-2xl">
              <div className="flex items-center gap-3 text-white min-w-0">
                {(() => { const Icon = getFileIcon(previewFile.fileName); return <Icon size={20} />; })()}
                <span className="text-sm font-medium truncate">{previewFile.fileName}</span>
                <span className="text-xs text-white/60">{formatFileSize(previewFile.fileSize)}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={getFileUrl(previewFile)}
                  download={previewFile.fileName}
                  className="p-2 hover:bg-white/20 rounded-lg text-white transition-colors"
                  title="다운로드"
                >
                  <Download size={18} />
                </a>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-2 hover:bg-white/20 rounded-lg text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 bg-white dark:bg-slate-900 rounded-b-2xl overflow-auto flex items-center justify-center min-h-[400px]">
              {isImageFile(previewFile) ? (
                <img
                  src={getFileUrl(previewFile)}
                  alt={previewFile.fileName}
                  className="max-w-full max-h-[80vh] object-contain"
                />
              ) : isPdfFile(previewFile) ? (
                <iframe
                  src={getFileUrl(previewFile)}
                  className="w-full h-[80vh] border-0"
                  title={previewFile.fileName}
                />
              ) : (
                <div className="text-center py-16">
                  <File size={64} className="mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-500 dark:text-gray-400 mb-4">이 파일 형식은 미리보기를 지원하지 않습니다</p>
                  <a
                    href={getFileUrl(previewFile)}
                    download={previewFile.fileName}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <Download size={16} /> 다운로드
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onSelect={createDirectChat} currentUserId={user?.id || ''} />}
    </div>
  );
}

function NewChatModal({ onClose, onSelect, currentUserId }: {
  onClose: () => void;
  onSelect: (userId: string) => void;
  currentUserId: string;
}) {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/users', { params: { limit: 100, status: 'active' } }).then(({ data }) => {
      setUsers((data.data || []).filter((u: any) => u.id !== currentUserId));
    });
  }, []);

  const filtered = users.filter(u =>
    u.name.includes(search) || u.employeeId.includes(search)
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md m-4" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b">
          <h3 className="font-bold text-lg">새 대화</h3>
          <div className="relative mt-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="이름 또는 사번으로 검색"
              className="input-field pl-9"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-80 overflow-auto">
          {filtered.map(u => (
            <button
              key={u.id}
              onClick={() => onSelect(u.id)}
              className="w-full flex items-center gap-3 p-3 hover:bg-primary-50/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-sm">
                {u.name[0]}
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{u.name}</p>
                <p className="text-xs text-gray-400">{u.employeeId} {u.department?.name && `| ${u.department.name}`}</p>
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t">
          <button onClick={onClose} className="btn-secondary w-full">취소</button>
        </div>
      </div>
    </div>
  );
}
