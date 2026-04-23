/**
 * 메일 실시간 이벤트 스토어
 *
 * App 루트에서 single 소켓 연결을 유지.
 * /mail Socket.IO 네임스페이스로부터 이벤트를 받아:
 *   - unreadCount: 사이드바 배지용
 *   - latestNotifications: 최근 3개 토스트 알림 큐
 *   - lastMailEvent: 각 페이지가 구독해서 목록 갱신 트리거
 */
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from './auth';

const SOCKET_URL = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

export interface IncomingMail {
  uid: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  sentAt: string;
  hasAttachment: boolean;
  folder: string;
  /** 클라이언트 내부 — 토스트 키 */
  id: string;
}

interface MailRealtimeState {
  socket: Socket | null;
  idleStatus: 'connected' | 'disconnected' | 'error' | 'unknown';
  unreadDelta: number;               // 세션 내 새로 도착한 개수 (사이드바 배지용)
  latestNotifications: IncomingMail[];
  lastMailEvent: number;              // 외부 페이지들이 이 값을 watch해서 목록 refetch 트리거

  connect: () => void;
  disconnect: () => void;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
}

export const useMailRealtime = create<MailRealtimeState>((set, get) => ({
  socket: null,
  idleStatus: 'unknown',
  unreadDelta: 0,
  latestNotifications: [],
  lastMailEvent: 0,

  connect: () => {
    if (get().socket) return;
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const socket = io(`${SOCKET_URL}/mail`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => {
      if (import.meta.env.DEV) console.debug('[mail-ws] connected');
    });

    socket.on('connect_error', (err) => {
      if (import.meta.env.DEV) console.warn('[mail-ws] connect_error', err.message);
    });

    socket.on('mail:idle-status', (data: { status: 'connected' | 'disconnected' | 'error' }) => {
      set({ idleStatus: data.status });
    });

    socket.on('mail:new', (msg: Omit<IncomingMail, 'id'>) => {
      const withId: IncomingMail = { ...msg, id: `${msg.folder}-${msg.uid}-${Date.now()}` };
      set((s) => ({
        unreadDelta: s.unreadDelta + 1,
        latestNotifications: [withId, ...s.latestNotifications].slice(0, 3),
        lastMailEvent: Date.now(),
      }));
      // 브라우저 Notification API (사용자가 허용한 경우만)
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(msg.fromName || msg.fromEmail, {
            body: msg.subject,
            tag: `mail-${msg.uid}`,
          });
        }
      } catch { /* safari/옛 브라우저 */ }
    });

    socket.on('mail:expunge', () => {
      set({ lastMailEvent: Date.now() });
    });

    socket.on('mail:flags', () => {
      set({ lastMailEvent: Date.now() });
    });

    set({ socket });
  },

  disconnect: () => {
    const s = get().socket;
    if (s) s.disconnect();
    set({ socket: null, idleStatus: 'unknown' });
  },

  dismissNotification: (id) => {
    set((s) => ({ latestNotifications: s.latestNotifications.filter((n) => n.id !== id) }));
  },

  clearAll: () => set({ unreadDelta: 0, latestNotifications: [] }),
}));
