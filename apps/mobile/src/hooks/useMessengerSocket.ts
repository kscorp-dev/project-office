/**
 * /messenger 네임스페이스 Socket.IO 연결을 싱글턴처럼 유지하는 훅.
 *
 * - 로그인 상태에서 최초 호출 시 접속
 * - 방 진입/퇴장: joinRoom(id) / leaveRoom(id) — 서버는 자동으로 유저 방들에 join 하지만
 *   의도적 foreground 방은 Activity 표시를 위해 강조.
 * - 서버 이벤트 리스너를 `on('message:new', cb)` 형식으로 훅에서 노출
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth';
import { API_BASE_URL } from '../services/api';

let sharedSocket: Socket | null = null;
let refCount = 0;

function socketBaseUrl(): string {
  // API_BASE_URL 예: http://localhost:3000/api → ws 연결은 http://localhost:3000
  return API_BASE_URL.replace(/\/api\/?$/, '');
}

function ensureSocket(token: string): Socket {
  if (sharedSocket && sharedSocket.connected) return sharedSocket;
  if (sharedSocket) {
    // 이전 소켓 disconnect 된 상태 — 토큰 갱신 후 다시 시도
    sharedSocket.auth = { token };
    sharedSocket.connect();
    return sharedSocket;
  }
  sharedSocket = io(`${socketBaseUrl()}/messenger`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  return sharedSocket;
}

export function useMessengerSocket() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const socket = ensureSocket(accessToken);
    socketRef.current = socket;
    refCount += 1;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      refCount -= 1;
      if (refCount <= 0) {
        socket.disconnect();
        sharedSocket = null;
        refCount = 0;
      }
    };
  }, [accessToken]);

  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => { socketRef.current?.off(event, handler); };
  }, []);

  return { connected, emit, on, socket: socketRef.current };
}
