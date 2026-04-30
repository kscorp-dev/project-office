/**
 * 대시보드 통합 stats 라우트
 *
 * 모바일 대시보드(/(tabs)/dashboard.tsx) 가 부팅 시 1회 호출.
 * 7개 카드(결재 대기 / 새 메시지 / 새 메일 / 오늘 일정 / 작업지시서 / 미체크인 / 미읽음 알림)
 * 의 카운트를 한 번의 응답으로 묶어 round-trip 7→1 로 줄인다.
 *
 * 의도적으로 간단한 count 위주로 유지 — 카드 탭 시 각 모듈로 진입해서
 * 상세 데이터를 받기 때문에 dashboard 는 "숫자 6개 + 출퇴근 상태" 만 알면 됨.
 */
import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/authenticate';
import { logger } from '../config/logger';

/** 오늘 00:00:00 ~ 23:59:59.999 범위 (서버 로컬 타임존 기준) */
function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const router = Router();

router.use(authenticate);

// GET /api/dashboard/summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const { start: today, end: tomorrow } = todayRange();

    // 7개 카운트를 병렬로 실행 — DB 한 번에 보내고 한 번에 받기
    const [
      pendingApprovals,
      unreadMessageRows,
      todayEvents,
      myActiveTasks,
      todayCheckIn,
      unreadNotifications,
      activeDelegationsTo, // 내가 위임자(toUser) 인 활성 위임 — 이 경우 위임받은 결재 대기 표시 가능
    ] = await Promise.all([
      // 1) 결재 대기 — 내가 현재 단계 approver 인 pending 라인의 도큐 수
      prisma.approvalDocument.count({
        where: {
          status: 'pending',
          lines: {
            some: {
              approverId: userId,
              status: 'pending',
            },
          },
        },
      }),
      // 2) 메신저 미읽음 — 활성 참여 룸에서 lastReadAt 이후 들어온 메시지 (참여자가 보낸 본인 메시지 제외)
      //   raw SQL 로 가져오는 게 효율적 (참여 룸 + lastReadAt 기준 messages count)
      prisma.$queryRaw<Array<{ unread: bigint }>>`
        SELECT COUNT(*) AS unread
        FROM messages m
        JOIN chat_participants cp ON cp.room_id = m.room_id
        WHERE cp.user_id = ${userId}
          AND cp.left_at IS NULL
          AND m.created_at > cp.last_read_at
          AND m.sender_id <> ${userId}
          AND m.is_deleted = false
      `,
      // 3) 오늘 일정 — 시작/종료가 today 와 겹치는 CalendarEvent 수
      //   scope=personal 은 본인 것만, all/department 는 권한 통합으로 다 보이도록 단순화
      prisma.calendarEvent.count({
        where: {
          isActive: true,
          startDate: { lte: tomorrow },
          endDate: { gte: today },
          OR: [
            { creatorId: userId },
            { scope: 'all' },
            // 부서 필터 — 사용자 부서 일치 시 노출 (없으면 무시)
            req.user!.departmentId
              ? { scope: 'personal_dept', departmentId: req.user!.departmentId }
              : { id: '__never__' },
            // 참석자로 등록된 경우
            { attendees: { some: { userId } } },
          ],
        },
      }),
      // 4) 작업지시서 — 내게 배정된 진행중(in_progress / instructed)
      prisma.taskOrder.count({
        where: {
          status: { in: ['in_progress', 'instructed'] },
          assignees: { some: { userId } },
        },
      }),
      // 5) 오늘 출근 체크 여부 — type='check_in' 인 attendance 가 today 시작 이후 1건이라도 있으면 OK
      prisma.attendance.findFirst({
        where: {
          userId,
          type: 'check_in',
          checkTime: { gte: today, lte: tomorrow },
        },
        select: { id: true, checkTime: true },
      }),
      // 6) 미읽음 알림 (벨 아이콘 카운트와 동일)
      prisma.notification.count({
        where: { recipientId: userId, isRead: false },
      }),
      // 7) 내가 받은 활성 위임 — 위임자 입장에선 본인 결재 대기에 더해 위임자 분도 응답해야 함
      prisma.approvalDelegation.findMany({
        where: {
          toUserId: userId,
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
        },
        select: { fromUserId: true, fromUser: { select: { name: true } } },
      }),
    ]);

    const unreadMessages = Number(unreadMessageRows?.[0]?.unread ?? 0);

    // 위임자가 있을 경우 본인 + 위임자들의 결재 대기 합산
    let delegatedPendingApprovals = 0;
    if (activeDelegationsTo.length > 0) {
      const delegatorIds = activeDelegationsTo.map((d) => d.fromUserId);
      delegatedPendingApprovals = await prisma.approvalDocument.count({
        where: {
          status: 'pending',
          lines: {
            some: { approverId: { in: delegatorIds }, status: 'pending' },
          },
        },
      });
    }

    res.json({
      success: true,
      data: {
        pendingApprovals,
        delegatedPendingApprovals, // 위임받은 결재 대기 (UI 에서 별도 배지)
        unreadMessages,
        unreadNotifications,
        todayEvents,
        myActiveTasks,
        attendance: {
          checkedIn: !!todayCheckIn,
          checkInAt: todayCheckIn?.checkTime ?? null,
        },
        delegations: activeDelegationsTo.map((d) => ({
          fromUserId: d.fromUserId,
          fromUserName: d.fromUser.name,
        })),
      },
    });
  } catch (err) {
    logger.warn({ err, path: req.path }, 'Dashboard summary failed');
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '대시보드 조회 실패' } });
  }
});

export default router;
