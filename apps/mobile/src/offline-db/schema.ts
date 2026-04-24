/**
 * 오프라인 캐시 SQLite 스키마 (부록 B 구현)
 *
 * 원칙:
 *   - 읽기 전용 캐시가 기본. 쓰기는 네트워크 가용 시만 (v1.0).
 *   - 각 테이블에 syncedAt(unix ms) 보관 → 오래된 캐시는 prune.
 *   - chat_messages 만 로컬 생성 지원 (pendingSync=true → 서버 도달 후 실ID 교체).
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/** 메신저 방 */
export const chatRooms = sqliteTable('chat_rooms', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),                      // 'direct' | 'group'
  name: text('name'),
  lastMessageAt: integer('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
  unreadCount: integer('unread_count').default(0),
  participantsJson: text('participants_json'),      // JSON.stringify 된 참가자 요약
  syncedAt: integer('synced_at').notNull(),
});

/** 개별 메시지 */
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  senderId: text('sender_id'),
  senderName: text('sender_name'),
  type: text('type').notNull(),                      // 'text' | 'image' | 'file' | 'system'
  content: text('content'),
  attachmentUrl: text('attachment_url'),
  createdAt: integer('created_at').notNull(),
  pendingSync: integer('pending_sync', { mode: 'boolean' }).default(false),
  retryCount: integer('retry_count').default(0),
}, (t) => ({
  byRoomIdx: index('msg_by_room').on(t.roomId, t.createdAt),
  pendingIdx: index('msg_pending').on(t.pendingSync),
}));

/** 메일 캐시 */
export const mailMessages = sqliteTable('mail_messages', {
  uid: text('uid').primaryKey(),                     // folder+uid 조합
  folder: text('folder').notNull(),
  subject: text('subject'),
  fromEmail: text('from_email'),
  fromName: text('from_name'),
  snippet: text('snippet'),
  isSeen: integer('is_seen', { mode: 'boolean' }).default(false),
  isFlagged: integer('is_flagged', { mode: 'boolean' }).default(false),
  hasAttachment: integer('has_attachment', { mode: 'boolean' }).default(false),
  sentAt: integer('sent_at'),
  syncedAt: integer('synced_at').notNull(),
}, (t) => ({
  byFolderIdx: index('mail_by_folder').on(t.folder, t.sentAt),
}));

/** 캘린더 일정 (앞뒤 30일) */
export const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  startAt: integer('start_at').notNull(),
  endAt: integer('end_at').notNull(),
  allDay: integer('all_day', { mode: 'boolean' }).default(false),
  location: text('location'),
  color: text('color'),
  categoryName: text('category_name'),
  creatorName: text('creator_name'),
  syncedAt: integer('synced_at').notNull(),
}, (t) => ({
  byRangeIdx: index('cal_by_range').on(t.startAt),
}));

/** 결재 문서 리스트 (탭별 box) */
export const approvalDocs = sqliteTable('approval_docs', {
  id: text('id').primaryKey(),
  box: text('box').notNull(),                        // 'pending' | 'drafts' | 'approved'
  docNumber: text('doc_number'),
  title: text('title').notNull(),
  status: text('status').notNull(),
  drafterName: text('drafter_name'),
  templateName: text('template_name'),
  submittedAt: integer('submitted_at'),
  createdAt: integer('created_at').notNull(),
  syncedAt: integer('synced_at').notNull(),
}, (t) => ({
  byBoxIdx: index('appr_by_box').on(t.box, t.submittedAt),
}));

/** 동기화 메타 */
export const syncMeta = sqliteTable('sync_meta', {
  key: text('key').primaryKey(),                     // 'rooms' | 'mail:INBOX' | 'calendar:2026-04'
  lastSyncedAt: integer('last_synced_at').notNull(),
  etag: text('etag'),
  errorCount: integer('error_count').default(0),
});
