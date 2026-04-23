/**
 * React Native 화상회의 훅
 *
 * 웹의 useWebRTC.ts와 동일한 역할을 하지만 `react-native-webrtc`를 사용해 모바일 네이티브에서 작동한다.
 *
 * 주의: 이 훅은 **EAS Custom Dev Client 빌드 환경에서만 동작**한다. (Expo Go 불가)
 *  - 네이티브 모듈 `react-native-webrtc`가 포함되어야 함
 *  - `app.json`에 `@config-plugins/react-native-webrtc` 등록 필요
 *
 * 시그널링 프로토콜: 서버와 동일한 `/meeting` Socket.IO 네임스페이스
 *   - meeting:join { meetingId }
 *   - meeting:peers { peers: [{ socketId, userId, name, ... }] }
 *   - meeting:peer-joined, meeting:peer-left
 *   - meeting:offer { to, sdp } / :answer / :ice-candidate
 *   - meeting:media-toggle { isMuted, isVideoOff }
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
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

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface UseWebRTCMobileOptions {
  meetingId: string;
  /** 웹과 공유하는 백엔드 URL — services/api의 baseURL에서 /api 제거 */
  socketUrl: string;
}

export function useWebRTCMobile({ meetingId, socketUrl }: UseWebRTCMobileOptions) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const socketRef = useRef<Socket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 카메라/마이크 초기화 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: 'user', width: 640, height: 480, frameRate: 30 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setLocalStream(stream as MediaStream);
      } catch (e) {
        // 권한 거부 또는 카메라 없음 → 오디오만 시도
        try {
          const audioOnly = await mediaDevices.getUserMedia({ audio: true });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          setLocalStream(audioOnly as MediaStream);
        } catch (e2) {
          setError((e2 as Error).message || '미디어 장치 접근 실패');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── PeerConnection 생성 헬퍼 ──
  const makePc = useCallback((socket: Socket, targetId: string, peerInfo: Omit<RemotePeer, 'stream'>) => {
    pcsRef.current.get(targetId)?.close();

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // 로컬 트랙 추가
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) {
        socket.emit('meeting:ice-candidate', { to: targetId, candidate: e.candidate.toJSON() });
      }
    });

    pc.addEventListener('track', (e: any) => {
      const stream = e.streams[0];
      if (!stream) return;
      setRemotePeers((prev) => {
        const next = new Map(prev);
        const existing = next.get(targetId);
        next.set(targetId, existing ? { ...existing, stream } : { ...peerInfo, socketId: targetId, stream });
        return next;
      });
    });

    pcsRef.current.set(targetId, pc);
    return pc;
  }, [localStream]);

  // ── 시그널링 소켓 연결 (로컬 스트림 준비된 뒤) ──
  useEffect(() => {
    if (!meetingId || !accessToken || !localStream) return;

    const socket = io(`${socketUrl}/meeting`, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('meeting:join', { meetingId });
    });

    socket.on('connect_error', (err) => {
      setError(err.message);
    });

    socket.on('meeting:error', (err: { code: string; message: string }) => {
      setError(`${err.code}: ${err.message}`);
    });

    // 기존 피어 목록 도착 → 모두에게 offer
    socket.on('meeting:peers', async (data: { peers: Omit<RemotePeer, 'stream'>[] }) => {
      for (const peer of data.peers) {
        setRemotePeers((prev) => {
          const next = new Map(prev);
          next.set(peer.socketId, { ...peer, stream: undefined });
          return next;
        });
        const pc = makePc(socket, peer.socketId, peer);
        try {
          const offer = await pc.createOffer({});
          await pc.setLocalDescription(offer);
          socket.emit('meeting:offer', { to: peer.socketId, sdp: pc.localDescription });
        } catch (e) {
          // offer 실패 — 무시하고 다음 peer
        }
      }
    });

    // 새 피어 입장 → 상대가 offer 보내옴 (우리는 answer)
    socket.on('meeting:peer-joined', (data: Omit<RemotePeer, 'stream' | 'isMuted' | 'isVideoOff'>) => {
      const peer = { ...data, isMuted: false, isVideoOff: false };
      setRemotePeers((prev) => {
        const next = new Map(prev);
        next.set(data.socketId, { ...peer, stream: undefined });
        return next;
      });
    });

    // Offer 수신 → answer
    socket.on('meeting:offer', async (data: { from: string; sdp: any }) => {
      let peerInfo: Omit<RemotePeer, 'stream'> = {
        socketId: data.from, userId: '', name: '참가자',
        isHost: false, isMuted: false, isVideoOff: false,
      };
      setRemotePeers((prev) => {
        const existing = prev.get(data.from);
        if (existing) peerInfo = { ...existing };
        return prev;
      });
      const pc = makePc(socket, data.from, peerInfo);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('meeting:answer', { to: data.from, sdp: pc.localDescription });
      } catch { /* ignore */ }
    });

    socket.on('meeting:answer', async (data: { from: string; sdp: any }) => {
      const pc = pcsRef.current.get(data.from);
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); }
      catch { /* ignore */ }
    });

    socket.on('meeting:ice-candidate', async (data: { from: string; candidate: any }) => {
      const pc = pcsRef.current.get(data.from);
      if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
      catch { /* ignore */ }
    });

    socket.on('meeting:media-toggled', (data: { socketId: string; isMuted: boolean; isVideoOff: boolean }) => {
      setRemotePeers((prev) => {
        const next = new Map(prev);
        const peer = next.get(data.socketId);
        if (peer) next.set(data.socketId, { ...peer, isMuted: data.isMuted, isVideoOff: data.isVideoOff });
        return next;
      });
    });

    socket.on('meeting:peer-left', (data: { socketId: string }) => {
      pcsRef.current.get(data.socketId)?.close();
      pcsRef.current.delete(data.socketId);
      setRemotePeers((prev) => {
        const next = new Map(prev);
        next.delete(data.socketId);
        return next;
      });
    });

    socket.on('disconnect', () => { setConnected(false); });

    return () => {
      socket.emit('meeting:leave');
      socket.disconnect();
      socketRef.current = null;
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
      setRemotePeers(new Map());
      setConnected(false);
    };
  }, [meetingId, accessToken, localStream, socketUrl, makePc]);

  /* ── 로컬 스트림 정리 (언마운트) ── */
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, [localStream]);

  /* ── 제어 함수 ── */
  const toggleMic = useCallback(() => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    socketRef.current?.emit('meeting:media-toggle', { isMuted: !track.enabled, isVideoOff: !localStream.getVideoTracks()[0]?.enabled });
  }, [localStream]);

  const toggleCam = useCallback(() => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    socketRef.current?.emit('meeting:media-toggle', { isMuted: !localStream.getAudioTracks()[0]?.enabled, isVideoOff: !track.enabled });
  }, [localStream]);

  const switchCamera = useCallback(() => {
    const videoTrack = localStream?.getVideoTracks()[0] as any;
    if (videoTrack && typeof videoTrack._switchCamera === 'function') {
      videoTrack._switchCamera();
    }
  }, [localStream]);

  const sendChat = useCallback((message: string) => {
    socketRef.current?.emit('meeting:chat', { message });
  }, []);

  return {
    localStream,
    remotePeers: Array.from(remotePeers.values()),
    connected,
    error,
    toggleMic,
    toggleCam,
    switchCamera,
    sendChat,
    socket: socketRef.current,
  };
}
