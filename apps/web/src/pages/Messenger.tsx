import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';
import { io, Socket } from 'socket.io-client';
import { MessageSquare, Send, Plus, Users, Search } from 'lucide-react';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

interface Room {
  id: string;
  name?: string;
  type: string;
  unreadCount: number;
  lastMessage?: { content: string; createdAt: string; sender?: { name: string } };
  participants: { user: { id: string; name: string; profileImage?: string } }[];
}

interface Msg {
  id: string;
  content: string;
  type: string;
  createdAt: string;
  sender?: { id: string; name: string; profileImage?: string };
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
      setMessages(prev => [...prev, msg]);
      fetchRooms(); // 목록 갱신
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
      <div className="w-80 border-r bg-white flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">메신저</h2>
          <button onClick={() => setShowNewChat(true)} className="p-2 hover:bg-primary-50/50 rounded-2xl">
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
                className={`w-full flex items-center gap-3 p-3 hover:bg-primary-50/50 transition-colors border-b ${
                  selectedRoom === room.id ? 'bg-primary-50' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {room.type === 'group' ? <Users size={18} /> : getRoomDisplayName(room)[0]}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate">{getRoomDisplayName(room)}</p>
                    {room.lastMessage && (
                      <span className="text-xs text-gray-400">
                        {new Date(room.lastMessage.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400 truncate">
                      {room.lastMessage ? room.lastMessage.content : '메시지가 없습니다'}
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
      <div className="flex-1 flex flex-col bg-primary-50/50">
        {selectedRoom ? (
          <>
            {/* Chat Header */}
            <div className="p-4 bg-white border-b">
              <h3 className="font-semibold">
                {getRoomDisplayName(rooms.find(r => r.id === selectedRoom)!)}
              </h3>
              {typing.length > 0 && (
                <p className="text-xs text-primary-500 mt-0.5">입력 중...</p>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {messages.map(msg => {
                const isMe = msg.sender?.id === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] ${isMe ? 'order-2' : ''}`}>
                      {!isMe && (
                        <p className="text-xs text-gray-500 mb-1 ml-1">{msg.sender?.name}</p>
                      )}
                      <div className={`px-3 py-2 rounded-2xl ${
                        isMe ? 'bg-primary-600 text-white rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md shadow-sm'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      <p className={`text-xs text-gray-400 mt-0.5 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white border-t">
              <div className="flex gap-2">
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
