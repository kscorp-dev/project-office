/**
 * expo-sqlite + drizzle 로 구성된 오프라인 캐시 DB.
 *
 * 초기화:
 *   - `app/_layout.tsx` 에서 마운트 시 `initOfflineDb()` 1회 호출
 *   - 스키마 drop/recreate 대신 CREATE TABLE IF NOT EXISTS 로 처리
 *     (drizzle-kit generate 가 현재 번들러 설정 없이 돌아가지 않으므로 MVP 는 수동 DDL)
 *
 * 사용:
 *   import { db } from '@/offline-db'
 *   await db.select().from(chatRooms);
 */
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

let _sqlite: SQLite.SQLiteDatabase | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

const DB_NAME = 'project-office-offline.db';

/** 최초 1회 호출. 이미 초기화돼 있으면 no-op */
export async function initOfflineDb(): Promise<void> {
  if (_sqlite) return;

  _sqlite = await SQLite.openDatabaseAsync(DB_NAME);

  // MVP: drizzle-kit 마이그레이션 대신 수동 DDL (IF NOT EXISTS)
  // 운영 단계에서 drizzle-kit 도입 시 migrations/ 디렉토리로 이관
  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      last_message_at INTEGER,
      last_message_preview TEXT,
      unread_count INTEGER DEFAULT 0,
      participants_json TEXT,
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      type TEXT NOT NULL,
      content TEXT,
      attachment_url TEXT,
      created_at INTEGER NOT NULL,
      pending_sync INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS msg_by_room ON chat_messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS msg_pending ON chat_messages(pending_sync);

    CREATE TABLE IF NOT EXISTS mail_messages (
      uid TEXT PRIMARY KEY NOT NULL,
      folder TEXT NOT NULL,
      subject TEXT,
      from_email TEXT,
      from_name TEXT,
      snippet TEXT,
      is_seen INTEGER DEFAULT 0,
      is_flagged INTEGER DEFAULT 0,
      has_attachment INTEGER DEFAULT 0,
      sent_at INTEGER,
      synced_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mail_by_folder ON mail_messages(folder, sent_at);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      all_day INTEGER DEFAULT 0,
      location TEXT,
      color TEXT,
      category_name TEXT,
      creator_name TEXT,
      synced_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cal_by_range ON calendar_events(start_at);

    CREATE TABLE IF NOT EXISTS approval_docs (
      id TEXT PRIMARY KEY NOT NULL,
      box TEXT NOT NULL,
      doc_number TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      drafter_name TEXT,
      template_name TEXT,
      submitted_at INTEGER,
      created_at INTEGER NOT NULL,
      synced_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS appr_by_box ON approval_docs(box, submitted_at);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY NOT NULL,
      last_synced_at INTEGER NOT NULL,
      etag TEXT,
      error_count INTEGER DEFAULT 0
    );
  `);

  _db = drizzle(_sqlite);
}

export function getDb(): ReturnType<typeof drizzle> {
  if (!_db) {
    throw new Error('offline-db 가 초기화되지 않았습니다. initOfflineDb() 를 먼저 호출하세요.');
  }
  return _db;
}

/** 편의를 위한 Proxy — 모듈 초기 import 시점에 db 가 아직 없어도 사용 가능 */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_t, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzle>];
  },
});

/** 로그아웃 / 유저 변경 시 전체 캐시 삭제 */
export async function clearOfflineDb(): Promise<void> {
  if (!_sqlite) return;
  await _sqlite.execAsync(`
    DELETE FROM chat_rooms;
    DELETE FROM chat_messages;
    DELETE FROM mail_messages;
    DELETE FROM calendar_events;
    DELETE FROM approval_docs;
    DELETE FROM sync_meta;
  `);
}

/** 주기적 정리 (테이블별 상한 적용) */
export async function pruneOfflineDb(): Promise<void> {
  if (!_sqlite) return;
  // 방당 최근 200건 초과 메시지 삭제
  await _sqlite.execAsync(`
    DELETE FROM chat_messages WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at DESC) rn
        FROM chat_messages
      ) WHERE rn <= 200
    );
    DELETE FROM mail_messages WHERE uid NOT IN (
      SELECT uid FROM (
        SELECT uid, ROW_NUMBER() OVER (PARTITION BY folder ORDER BY sent_at DESC) rn
        FROM mail_messages
      ) WHERE rn <= 50
    );
    DELETE FROM calendar_events
    WHERE start_at < ${Date.now() - 30 * 86400 * 1000}
       OR start_at > ${Date.now() + 30 * 86400 * 1000};
  `);
}
