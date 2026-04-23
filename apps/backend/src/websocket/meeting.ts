import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/prisma';
import { JwtPayload } from '../middleware/authenticate';
import { logger } from '../config/logger';

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
    } catch (err) {
      logger.warn({ err }, 'Internal error');
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

        // DB에서 유저 정보 조회 (+ 역할: 관리자 판단)
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, position: true, role: true },
        });
        if (!dbUser) {
          socket.emit('meeting:error', { code: 'USER_NOT_FOUND', message: '사용자를 찾을 수 없습니다' });
          return;
        }

        // 권한 검증 — 호스트, 초대받은 사람, 참여 기록 있는 사람, 관리자만 입장 가능
        const { canJoinMeeting } = await import('../services/meeting.service');
        const access = await canJoinMeeting({
          meetingId,
          userId: dbUser.id,
          userRole: dbUser.role,
        });
        if (!access.ok) {
          const codeMap: Record<string, { code: string; msg: string }> = {
            NOT_FOUND:    { code: 'MEETING_NOT_FOUND', msg: '회의를 찾을 수 없습니다' },
            NOT_ALLOWED:  { code: 'MEETING_ACCESS_DENIED', msg: '이 회의에 참여할 권한이 없습니다' },
            NOT_ACTIVE:   { code: 'MEETING_NOT_ACTIVE', msg: '진행 중인 회의가 아닙니다' },
            CANCELLED:    { code: 'MEETING_CANCELLED', msg: '취소된 회의입니다' },
          };
          const e = codeMap[access.reason || 'NOT_ALLOWED'] || codeMap.NOT_ALLOWED;
          socket.emit('meeting:error', e);
          return;
        }

        // 회의 정보 (maxParticipants 확인용)
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

        // 최대 인원 확인 (2~16명)
        const maxCap = Math.min(mtg.maxParticipants || 16, 16);
        if (room.size >= maxCap) {
          socket.emit('meeting:error', {
            code: 'ROOM_FULL',
            message: `회의실이 가득 찼습니다 (최대 ${maxCap}명)`,
          });
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

    // ────── 회의록 공유 (STT 결과 브로드캐스트 + isFinal 저장) ──────
    socket.on('meeting:transcript', async (data: { meetingId: string; text: string; isFinal: boolean }) => {
      const room = rooms.get(data.meetingId);
      if (!room) return;

      const participant = room.get(socket.id);
      if (!participant) return;

      const text = (data.text || '').trim();
      if (!text) return;

      // 실시간 브로드캐스트 (interim + final 모두)
      socket.to(data.meetingId).emit('meeting:transcript', {
        id: `tr-${Date.now()}-${socket.id.slice(-4)}`,
        speaker: participant.name,
        text,
        isFinal: data.isFinal,
        timestamp: new Date().toISOString(),
      });

      // 확정된 발언(isFinal=true)만 DB 저장 — AI 요약 입력 소스
      if (data.isFinal) {
        try {
          await prisma.meetingTranscript.create({
            data: {
              meetingId: data.meetingId,
              speakerId: participant.userId,
              speakerName: participant.name,
              text,
            },
          });
        } catch (err) {
          // 회의가 DB에 없거나(테스트용 가상 방) 일시적 DB 오류 — 로그만
          console.warn('[Meeting WS] transcript persist failed:', (err as Error).message);
        }
      }
    });

    // ────── 문서 공유 알림 (REST 업로드 후 호출) ──────
    socket.on('meeting:share-document', (data: { meetingId: string; document: unknown }) => {
      socket.to(data.meetingId).emit('meeting:document-shared', data.document);
    });

    // ────── 문서 삭제 알림 ──────
    socket.on('meeting:remove-document', (data: { meetingId: string; documentId: string }) => {
      socket.to(data.meetingId).emit('meeting:document-removed', { documentId: data.documentId });
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
