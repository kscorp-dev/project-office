import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/prisma';
import { JwtPayload } from '../middleware/authenticate';

interface AuthSocket extends Socket {
  data: { user: JwtPayload; meetingId?: string; userName?: string };
}

/** 회의실 참가자 정보 */
interface RoomParticipant {
  socketId: string;
  userId: string;
  name: string;
  position?: string;
  isHost: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  joinedAt: Date;
}

/** 회의실 Map: meetingId → participants */
const rooms = new Map<string, Map<string, RoomParticipant>>();

export function setupMeetingSocket(io: SocketIOServer) {
  const meeting = io.of('/meeting');

  // JWT 인증 미들웨어
  meeting.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('UNAUTHORIZED'));

    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  meeting.on('connection', (socket: AuthSocket) => {
    const userId = socket.data.user.sub;
    console.log(`[Meeting WS] Connected: ${userId} (${socket.id})`);

    // ────── 회의 참가 ──────
    socket.on('meeting:join', async (data: { meetingId: string }) => {
      try {
        const { meetingId } = data;

        // DB에서 유저 정보 조회
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, position: true },
        });
        if (!dbUser) {
          socket.emit('meeting:error', { code: 'USER_NOT_FOUND', message: '사용자를 찾을 수 없습니다' });
          return;
        }

        // 회의 정보 조회
        const mtg = await prisma.meeting.findUnique({
          where: { id: meetingId },
          select: { id: true, hostId: true, status: true, maxParticipants: true },
        });
        if (!mtg) {
          socket.emit('meeting:error', { code: 'MEETING_NOT_FOUND', message: '회의를 찾을 수 없습니다' });
          return;
        }

        // 회의실 생성 (없으면)
        if (!rooms.has(meetingId)) {
          rooms.set(meetingId, new Map());
        }
        const room = rooms.get(meetingId)!;

        // 최대 인원 확인
        if (mtg.maxParticipants && room.size >= mtg.maxParticipants) {
          socket.emit('meeting:error', { code: 'ROOM_FULL', message: '회의실이 가득 찼습니다' });
          return;
        }

        const isHost = mtg.hostId === userId;

        // 참가자 정보 저장
        const participant: RoomParticipant = {
          socketId: socket.id,
          userId: dbUser.id,
          name: dbUser.name,
          position: dbUser.position ?? undefined,
          isHost,
          isMuted: false,
          isVideoOff: false,
          joinedAt: new Date(),
        };
        room.set(socket.id, participant);

        // Socket.io 방 입장
        socket.join(meetingId);
        socket.data.meetingId = meetingId;
        socket.data.userName = dbUser.name;

        // DB 참가 시간 업데이트
        await prisma.meetingParticipant.updateMany({
          where: { meetingId, userId },
          data: { joinedAt: new Date() },
        }).catch(() => { /* 참가자 레코드 없을 수 있음 */ });

        // 기존 참가자 목록을 새 참가자에게 전송
        const existingPeers = Array.from(room.entries())
          .filter(([sid]) => sid !== socket.id)
          .map(([sid, p]) => ({
            socketId: sid,
            userId: p.userId,
            name: p.name,
            position: p.position,
            isHost: p.isHost,
            isMuted: p.isMuted,
            isVideoOff: p.isVideoOff,
          }));

        socket.emit('meeting:peers', { peers: existingPeers });

        // 기존 참가자들에게 새 참가자 입장 알림
        socket.to(meetingId).emit('meeting:peer-joined', {
          socketId: socket.id,
          userId: participant.userId,
          name: participant.name,
          position: participant.position,
          isHost: participant.isHost,
        });

        console.log(`[Meeting WS] ${dbUser.name} joined room ${meetingId} (${room.size} participants)`);
      } catch (err) {
        console.error('[Meeting WS] Join error:', err);
        socket.emit('meeting:error', { code: 'JOIN_FAILED', message: '회의 참가에 실패했습니다' });
      }
    });

    // ────── WebRTC SDP Offer ──────
    socket.on('meeting:offer', (data: { to: string; sdp: unknown }) => {
      socket.to(data.to).emit('meeting:offer', {
        from: socket.id,
        sdp: data.sdp,
      });
    });

    // ────── WebRTC SDP Answer ──────
    socket.on('meeting:answer', (data: { to: string; sdp: unknown }) => {
      socket.to(data.to).emit('meeting:answer', {
        from: socket.id,
        sdp: data.sdp,
      });
    });

    // ────── WebRTC ICE Candidate ──────
    socket.on('meeting:ice-candidate', (data: { to: string; candidate: unknown }) => {
      socket.to(data.to).emit('meeting:ice-candidate', {
        from: socket.id,
        candidate: data.candidate,
      });
    });

    // ────── 미디어 상태 변경 (음소거/카메라) ──────
    socket.on('meeting:media-toggle', (data: { meetingId: string; isMuted?: boolean; isVideoOff?: boolean }) => {
      const room = rooms.get(data.meetingId);
      if (!room) return;

      const participant = room.get(socket.id);
      if (!participant) return;

      if (data.isMuted !== undefined) participant.isMuted = data.isMuted;
      if (data.isVideoOff !== undefined) participant.isVideoOff = data.isVideoOff;

      socket.to(data.meetingId).emit('meeting:media-toggled', {
        socketId: socket.id,
        isMuted: participant.isMuted,
        isVideoOff: participant.isVideoOff,
      });
    });

    // ────── 화면 공유 시작/중지 ──────
    socket.on('meeting:screen-share', (data: { meetingId: string; isSharing: boolean }) => {
      socket.to(data.meetingId).emit('meeting:screen-share', {
        socketId: socket.id,
        userId,
        isSharing: data.isSharing,
      });
    });

    // ────── 인-미팅 채팅 ──────
    socket.on('meeting:chat', (data: { meetingId: string; message: string }) => {
      const room = rooms.get(data.meetingId);
      if (!room) return;

      const participant = room.get(socket.id);
      if (!participant) return;

      meeting.to(data.meetingId).emit('meeting:chat', {
        id: `chat-${Date.now()}-${socket.id.slice(-4)}`,
        userId: participant.userId,
        name: participant.name,
        message: data.message,
        timestamp: new Date().toISOString(),
      });
    });

    // ────── 회의록 공유 (STT 결과 브로드캐스트) ──────
    socket.on('meeting:transcript', (data: { meetingId: string; text: string; isFinal: boolean }) => {
      const room = rooms.get(data.meetingId);
      if (!room) return;

      const participant = room.get(socket.id);
      if (!participant) return;

      socket.to(data.meetingId).emit('meeting:transcript', {
        id: `tr-${Date.now()}-${socket.id.slice(-4)}`,
        speaker: participant.name,
        text: data.text,
        isFinal: data.isFinal,
        timestamp: new Date().toISOString(),
      });
    });

    // ────── 퇴장 ──────
    socket.on('meeting:leave', () => {
      handleLeave(socket, meeting);
    });

    socket.on('disconnect', () => {
      handleLeave(socket, meeting);
      console.log(`[Meeting WS] Disconnected: ${userId} (${socket.id})`);
    });
  });
}

function handleLeave(socket: AuthSocket, namespace: any) {
  const meetingId = socket.data.meetingId;
  if (!meetingId) return;

  const room = rooms.get(meetingId);
  if (!room) return;

  const participant = room.get(socket.id);
  room.delete(socket.id);

  // 다른 참가자들에게 퇴장 알림
  socket.to(meetingId).emit('meeting:peer-left', {
    socketId: socket.id,
    userId: socket.data.user.sub,
    name: participant?.name || '알 수 없음',
  });

  socket.leave(meetingId);
  socket.data.meetingId = undefined;

  // DB 퇴장 시간 업데이트
  prisma.meetingParticipant.updateMany({
    where: { meetingId, userId: socket.data.user.sub },
    data: { leftAt: new Date() },
  }).catch(() => {});

  // 빈 방 정리
  if (room.size === 0) {
    rooms.delete(meetingId);
    console.log(`[Meeting WS] Room ${meetingId} closed (empty)`);
  }
}
