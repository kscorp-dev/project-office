/**
 * 회의 접근 권한 유틸리티
 *
 * 웹 REST 라우트와 WebSocket 시그널링에서 공통으로 사용.
 *
 * 정의: "회의 접근 권한" = 다음 중 하나
 *   1) 시스템 관리자 (super_admin, admin)
 *   2) 회의 호스트 본인
 *   3) MeetingParticipant로 등록되어 있고 아직 leftAt=null (아직 나가지 않음)
 *      또는 leftAt이 있어도 최초 입장 이력이 있는 사람
 *
 * "참가 이력자" (viewer) — 문서 조회 등 read-only 작업용
 *   → 한번이라도 참가 기록 있으면 사후 열람 허용
 *
 * "현재 참가 가능" (joinable) — 실시간 참여용
 *   → 호스트 또는 초대받은 사람(isInvited=true) 또는 참여 기록 있는 사람
 *   → 회의 상태가 in_progress 또는 scheduled(호스트가 시작 가능)
 */
import prisma from '../config/prisma';

export interface MeetingAccessContext {
  meetingId: string;
  userId: string;
  userRole: string;
}

interface MeetingAccessResult {
  ok: boolean;
  reason?: 'NOT_FOUND' | 'NOT_ALLOWED' | 'NOT_ACTIVE' | 'CANCELLED';
  meeting?: {
    id: string;
    hostId: string;
    status: string;
    title: string;
  };
}

/**
 * 회의 및 회의 관련 문서에 대한 읽기 권한 검사
 * (참가 이력자는 회의 종료 후에도 문서 조회 가능)
 */
export async function canViewMeeting(ctx: MeetingAccessContext): Promise<MeetingAccessResult> {
  if (isAdmin(ctx.userRole)) {
    const m = await prisma.meeting.findUnique({
      where: { id: ctx.meetingId },
      select: { id: true, hostId: true, status: true, title: true },
    });
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, meeting: m };
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: ctx.meetingId },
    select: {
      id: true, hostId: true, status: true, title: true,
      participants: {
        where: { userId: ctx.userId },
        select: { userId: true, joinedAt: true, leftAt: true, isInvited: true },
      },
    },
  });
  if (!meeting) return { ok: false, reason: 'NOT_FOUND' };

  const isHost = meeting.hostId === ctx.userId;
  // 참가자 테이블에 등록되어 있으면 (초대받거나 실제 참여) → 조회 허용
  const hasParticipationRecord = meeting.participants.length > 0;

  if (!isHost && !hasParticipationRecord) {
    return { ok: false, reason: 'NOT_ALLOWED', meeting: pickPublic(meeting) };
  }

  return { ok: true, meeting: pickPublic(meeting) };
}

/**
 * 회의 실시간 참여 권한 검사 (WebSocket join, 파일 업로드 등)
 * - 회의 상태가 반드시 in_progress 또는 scheduled여야 함
 * - 호스트 또는 초대받은 참가자만 가능
 */
export async function canJoinMeeting(ctx: MeetingAccessContext): Promise<MeetingAccessResult> {
  const admin = isAdmin(ctx.userRole);

  const meeting = await prisma.meeting.findUnique({
    where: { id: ctx.meetingId },
    select: {
      id: true, hostId: true, status: true, title: true,
      participants: {
        where: { userId: ctx.userId },
        select: { userId: true, isInvited: true, joinedAt: true, leftAt: true },
      },
    },
  });
  if (!meeting) return { ok: false, reason: 'NOT_FOUND' };
  if (meeting.status === 'cancelled') return { ok: false, reason: 'CANCELLED', meeting: pickPublic(meeting) };
  if (meeting.status !== 'in_progress' && meeting.status !== 'scheduled') {
    return { ok: false, reason: 'NOT_ACTIVE', meeting: pickPublic(meeting) };
  }

  if (admin) return { ok: true, meeting: pickPublic(meeting) };

  const isHost = meeting.hostId === ctx.userId;
  const isInvitedOrJoined = meeting.participants.some((p) => p.isInvited || p.joinedAt);

  if (!isHost && !isInvitedOrJoined) {
    return { ok: false, reason: 'NOT_ALLOWED', meeting: pickPublic(meeting) };
  }
  return { ok: true, meeting: pickPublic(meeting) };
}

function isAdmin(role: string): boolean {
  return role === 'super_admin' || role === 'admin';
}

function pickPublic(m: { id: string; hostId: string; status: string; title: string }) {
  return { id: m.id, hostId: m.hostId, status: m.status, title: m.title };
}
