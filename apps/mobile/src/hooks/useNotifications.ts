/**
 * 모바일 알림 훅 (v0.19.0)
 *
 * - 주기적으로 unread-count fetch (30초)
 * - WebSocket /notifications로 실시간 수신
 * - markAsRead / markAllAsRead 헬퍼 제공
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { api, API_BASE_URL } from '../services/api';
import { useAuthStore } from '../store/auth';

const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

export interface Notification {
  id: string;
  recipientId: string;
  actorId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  refType?: string | null;
  refId?: string | null;
  isRead: boolean;
  createdAt: string;
  actor?: { id: string; name: string; position?: string | null } | null;
}

export function useNotifications() {
  const token = useAuthStore((s) => s.accessToken);
  const [unreadCount, setUnreadCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadCount(data.data?.count ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!token) return;

    // 초기 조회 + 30초마다 재조회 (소켓 끊겼을 때 대비)
    void fetchUnread();
    const iv = setInterval(fetchUnread, 30_000);

    // WebSocket 실시간
    const socket = io(`${SOCKET_URL}/notifications`, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('notification:new', () => {
      void fetchUnread();
    });

    socket.on('notification:unread', (payload: { count: number }) => {
      setUnreadCount(payload.count ?? 0);
    });

    return () => {
      clearInterval(iv);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, fetchUnread]);

  return {
    unreadCount,
    refresh: fetchUnread,
  };
}

export async function fetchNotifications(opts: { page?: number; limit?: number; unreadOnly?: boolean } = {}): Promise<{
  rows: Notification[];
  total: number;
  unread: number;
  page: number;
  totalPages: number;
}> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.unreadOnly) params.set('unreadOnly', 'true');
  const { data } = await api.get(`/notifications?${params.toString()}`);
  return {
    rows: data.data || [],
    total: data.meta?.total ?? 0,
    unread: data.meta?.unread ?? 0,
    page: data.meta?.page ?? 1,
    totalPages: data.meta?.totalPages ?? 1,
  };
}

export async function markNotificationAsRead(id: string): Promise<void> {
  await api.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsAsRead(): Promise<void> {
  await api.post('/notifications/mark-all-read');
}
