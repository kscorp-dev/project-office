import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth';

/* ── 타입 ── */
export interface RemotePeer {
  socketId: string;
  userId: string;
  name: string;
  position?: string;
  isHost: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  stream?: MediaStream;
}

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  message: string;
  timestamp: string;
}

export interface TranscriptMessage {
  id: string;
  speaker: string;
  text: string;
  isFinal: boolean;
  timestamp: string;
}

interface UseWebRTCOptions {
  meetingId: string;
  localStream: MediaStream | null;
  onPeerJoined?: (peer: RemotePeer) => void;
  onPeerLeft?: (peer: { socketId: string; userId: string; name: string }) => void;
  onChat?: (msg: ChatMessage) => void;
  onTranscript?: (entry: TranscriptMessage) => void;
}

const SOCKET_URL = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useWebRTC({
  meetingId,
  localStream,
  onPeerJoined,
  onPeerLeft,
  onChat,
  onTranscript,
}: UseWebRTCOptions) {
  const accessToken = useAuthStore(s => s.accessToken);
  const socketRef = useRef<Socket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
  const [connected, setConnected] = useState(false);

  // 모든 변동 값을 ref로 관리 (useEffect 의존성 안정화)
  const localStreamRef = useRef(localStream);
  const cbJoined = useRef(onPeerJoined);
  const cbLeft = useRef(onPeerLeft);
  const cbChat = useRef(onChat);
  const cbTranscript = useRef(onTranscript);

  localStreamRef.current = localStream;
  cbJoined.current = onPeerJoined;
  cbLeft.current = onPeerLeft;
  cbChat.current = onChat;
  cbTranscript.current = onTranscript;

  /* ── 헬퍼: PeerConnection 생성 ── */
  function makePc(socket: Socket, targetId: string, peerInfo: Omit<RemotePeer, 'stream'>) {
    // 기존 연결 정리
    pcsRef.current.get(targetId)?.close();

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // 로컬 트랙 추가
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('meeting:ice-candidate', { to: targetId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      setRemotePeers(prev => {
        const next = new Map(prev);
        const existing = next.get(targetId);
        next.set(targetId, existing ? { ...existing, stream } : { ...peerInfo, socketId: targetId, stream });
        return next;
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn(`[WebRTC] Connection to ${targetId} failed`);
      }
    };

    pcsRef.current.set(targetId, pc);
    return pc;
  }

  /* ── 소켓 연결 (meetingId / accessToken만 의존) ── */
  useEffect(() => {
    if (!meetingId || !accessToken) return;

    const socket = io(`${SOCKET_URL}/meeting`, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Meeting Socket] Connected');
      setConnected(true);
      socket.emit('meeting:join', { meetingId });
    });

    socket.on('connect_error', (err) => {
      console.error('[Meeting Socket] Connection error:', err.message);
    });

    // 기존 피어 목록
    socket.on('meeting:peers', async (data: { peers: Omit<RemotePeer, 'stream'>[] }) => {
      for (const peer of data.peers) {
        setRemotePeers(prev => {
          const next = new Map(prev);
          next.set(peer.socketId, { ...peer, stream: undefined });
          return next;
        });
        // Offer 전송
        const pc = makePc(socket, peer.socketId, peer);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('meeting:offer', { to: peer.socketId, sdp: pc.localDescription });
        } catch (err) {
          console.error('[WebRTC] createOffer error:', err);
        }
      }
    });

    // 새 피어 입장
    socket.on('meeting:peer-joined', (data: Omit<RemotePeer, 'stream' | 'isMuted' | 'isVideoOff'>) => {
      const peer = { ...data, isMuted: false, isVideoOff: false };
      setRemotePeers(prev => {
        const next = new Map(prev);
        next.set(data.socketId, { ...peer, stream: undefined });
        return next;
      });
      cbJoined.current?.({ ...peer, stream: undefined });
    });

    // Offer 수신
    socket.on('meeting:offer', async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      let peerInfo: Omit<RemotePeer, 'stream'> = {
        socketId: data.from, userId: '', name: '참가자',
        isHost: false, isMuted: false, isVideoOff: false,
      };
      // remotePeers에서 정보 조회
      setRemotePeers(prev => {
        const existing = prev.get(data.from);
        if (existing) peerInfo = { ...existing };
        return prev; // 변경 없음
      });

      const pc = makePc(socket, data.from, peerInfo);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('meeting:answer', { to: data.from, sdp: pc.localDescription });
      } catch (err) {
        console.error('[WebRTC] handleOffer error:', err);
      }
    });

    // Answer 수신
    socket.on('meeting:answer', async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = pcsRef.current.get(data.from);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } catch (err) {
        console.error('[WebRTC] handleAnswer error:', err);
      }
    });

    // ICE Candidate
    socket.on('meeting:ice-candidate', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = pcsRef.current.get(data.from);
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('[WebRTC] addIceCandidate error:', err);
      }
    });

    // 미디어 상태 변경
    socket.on('meeting:media-toggled', (data: { socketId: string; isMuted: boolean; isVideoOff: boolean }) => {
      setRemotePeers(prev => {
        const next = new Map(prev);
        const peer = next.get(data.socketId);
        if (peer) next.set(data.socketId, { ...peer, isMuted: data.isMuted, isVideoOff: data.isVideoOff });
        return next;
      });
    });

    // 피어 퇴장
    socket.on('meeting:peer-left', (data: { socketId: string; userId: string; name: string }) => {
      pcsRef.current.get(data.socketId)?.close();
      pcsRef.current.delete(data.socketId);
      setRemotePeers(prev => {
        const next = new Map(prev);
        next.delete(data.socketId);
        return next;
      });
      cbLeft.current?.(data);
    });

    // 채팅
    socket.on('meeting:chat', (msg: ChatMessage) => cbChat.current?.(msg));

    // 회의록
    socket.on('meeting:transcript', (entry: TranscriptMessage) => cbTranscript.current?.(entry));

    // 에러
    socket.on('meeting:error', (err: { code: string; message: string }) => {
      console.error(`[Meeting Socket] Error: ${err.code} — ${err.message}`);
    });

    socket.on('disconnect', () => {
      console.log('[Meeting Socket] Disconnected');
      setConnected(false);
    });

    return () => {
      socket.emit('meeting:leave');
      socket.disconnect();
      socketRef.current = null;
      pcsRef.current.forEach(pc => pc.close());
      pcsRef.current.clear();
      setRemotePeers(new Map());
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, accessToken]);

  /* ── 로컬 스트림 변경 시 트랙 교체 ── */
  useEffect(() => {
    if (!localStream) return;
    pcsRef.current.forEach(pc => {
      const senders = pc.getSenders();
      localStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track?.kind === track.kind);
        if (sender) sender.replaceTrack(track).catch(console.error);
        else pc.addTrack(track, localStream);
      });
    });
  }, [localStream]);

  /* ── 외부 API ── */
  const sendMediaToggle = useCallback((isMuted: boolean, isVideoOff: boolean) => {
    socketRef.current?.emit('meeting:media-toggle', { meetingId, isMuted, isVideoOff });
  }, [meetingId]);

  const sendScreenShare = useCallback((isSharing: boolean) => {
    socketRef.current?.emit('meeting:screen-share', { meetingId, isSharing });
  }, [meetingId]);

  const sendChat = useCallback((message: string) => {
    socketRef.current?.emit('meeting:chat', { meetingId, message });
  }, [meetingId]);

  const sendTranscript = useCallback((text: string, isFinal: boolean) => {
    socketRef.current?.emit('meeting:transcript', { meetingId, text, isFinal });
  }, [meetingId]);

  const leave = useCallback(() => {
    socketRef.current?.emit('meeting:leave');
    socketRef.current?.disconnect();
    pcsRef.current.forEach(pc => pc.close());
    pcsRef.current.clear();
    setRemotePeers(new Map());
    setConnected(false);
  }, []);

  return {
    connected,
    remotePeers: Array.from(remotePeers.values()),
    sendMediaToggle,
    sendScreenShare,
    sendChat,
    sendTranscript,
    leave,
  };
}
