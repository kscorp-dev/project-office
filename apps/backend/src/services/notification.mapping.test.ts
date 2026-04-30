/**
 * NotificationType → 모바일 push 페이로드 매핑 테스트
 *
 * 모바일 hooks/usePushNotifications.ts 의 resolveDeepLink + Notification Categories
 * (approval / message) 와 1:1 매칭되는지 검증.
 *
 * 단위 테스트 — DB 불필요.
 */
import { describe, it, expect } from 'vitest';
import { mapToMobilePayload } from './notification.service';

describe('mapToMobilePayload', () => {
  describe('결재 (approval_*)', () => {
    it('approval_pending → categoryId=approval (인라인 승인/반려 활성)', () => {
      const r = mapToMobilePayload({
        recipientId: 'u1',
        type: 'approval_pending' as any,
        title: 't', refId: 'doc-1',
      });
      expect(r.mobileType).toBe('approval');
      expect(r.mobileExtra.id).toBe('doc-1');
      expect(r.categoryId).toBe('approval');
    });

    it('approval_approved → categoryId 없음 (이미 처리된 결과)', () => {
      const r = mapToMobilePayload({
        recipientId: 'u1', type: 'approval_approved' as any, title: 't', refId: 'doc-1',
      });
      expect(r.mobileType).toBe('approval');
      expect(r.categoryId).toBeUndefined();
    });

    it.each(['approval_rejected', 'approval_recalled', 'approval_reference'])(
      '%s → mobileType=approval, no category',
      (t) => {
        const r = mapToMobilePayload({ recipientId: 'u', type: t as any, title: 't', refId: 'd' });
        expect(r.mobileType).toBe('approval');
        expect(r.categoryId).toBeUndefined();
      },
    );
  });

  describe('메신저 (message_*)', () => {
    it('message_received → roomId 키 + categoryId=message', () => {
      const r = mapToMobilePayload({
        recipientId: 'u1', type: 'message_received' as any, title: 't', refId: 'room-9',
      });
      expect(r.mobileType).toBe('message');
      expect(r.mobileExtra.roomId).toBe('room-9');
      expect(r.categoryId).toBe('message');
    });

    it('message_mention 도 동일', () => {
      const r = mapToMobilePayload({
        recipientId: 'u1', type: 'message_mention' as any, title: 't', refId: 'room-9',
      });
      expect(r.mobileType).toBe('message');
      expect(r.categoryId).toBe('message');
    });
  });

  describe('메일 (mail_*)', () => {
    it('mail_received → uid 키, no category', () => {
      const r = mapToMobilePayload({
        recipientId: 'u1', type: 'mail_received' as any, title: 't', refId: '5001',
      });
      expect(r.mobileType).toBe('mail');
      expect(r.mobileExtra.uid).toBe('5001');
      expect(r.categoryId).toBeUndefined();
    });
  });

  describe('회의 (meeting_*)', () => {
    it.each(['meeting_invited', 'meeting_starting_soon', 'meeting_minutes_ready'])(
      '%s → mobileType=meeting, id 키',
      (t) => {
        const r = mapToMobilePayload({
          recipientId: 'u', type: t as any, title: 't', refId: 'm-1',
        });
        expect(r.mobileType).toBe('meeting');
        expect(r.mobileExtra.id).toBe('m-1');
      },
    );

    it('meeting_invited → categoryId=meeting (인라인 수락/거절 버튼)', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'meeting_invited' as any, title: 't', refId: 'm-1',
      });
      expect(r.categoryId).toBe('meeting');
    });

    it('meeting_starting_soon / meeting_minutes_ready → categoryId 없음', () => {
      for (const t of ['meeting_starting_soon', 'meeting_minutes_ready']) {
        const r = mapToMobilePayload({
          recipientId: 'u', type: t as any, title: 't', refId: 'm-1',
        });
        expect(r.categoryId).toBeUndefined();
      }
    });

    it('meta.ring=true → mobileExtra.ring="1" (VoIP 즉시 호출 신호)', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'meeting_invited' as any, title: 't', refId: 'm-1',
        meta: { ring: true, hostName: '김부장' } as any,
      });
      expect(r.mobileExtra.ring).toBe('1');
      expect(r.mobileExtra.hostName).toBe('김부장');
    });

    it('meta 없음 → ring/hostName 모두 undefined', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'meeting_invited' as any, title: 't', refId: 'm-1',
      });
      expect(r.mobileExtra.ring).toBeUndefined();
      expect(r.mobileExtra.hostName).toBeUndefined();
    });
  });

  describe('작업지시서 (task_*)', () => {
    it('task_assigned → mobileType=task', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'task_assigned' as any, title: 't', refId: 'task-1',
      });
      expect(r.mobileType).toBe('task');
      expect(r.mobileExtra.id).toBe('task-1');
    });

    it('task_status_changed 도 동일', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'task_status_changed' as any, title: 't', refId: 'task-2',
      });
      expect(r.mobileType).toBe('task');
    });
  });

  describe('휴가 / 게시판 / 시스템', () => {
    it('vacation_approved → vacation', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'vacation_approved' as any, title: 't', refId: 'v-1',
      });
      expect(r.mobileType).toBe('vacation');
    });

    it('post_must_read → post', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'post_must_read' as any, title: 't', refId: 'p-1',
      });
      expect(r.mobileType).toBe('post');
    });

    it('알 수 없는 type → 원본 유지 (fallback)', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'system' as any, title: 't', refId: 's-1',
      });
      expect(r.mobileType).toBe('system');
      expect(r.mobileExtra.id).toBe('s-1');
    });
  });

  describe('refId 누락', () => {
    it('refId 없으면 mobileExtra.id 도 undefined', () => {
      const r = mapToMobilePayload({
        recipientId: 'u', type: 'system' as any, title: 't',
      });
      expect(r.mobileExtra.id).toBeUndefined();
    });
  });
});
