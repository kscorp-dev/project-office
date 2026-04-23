-- 성능 최적화 인덱스 (v0.19.0)
-- 대규모 조직에서 자주 실행되는 쿼리 패턴에 맞춘 복합 인덱스.
-- Prisma schema에는 @@index로 반영, DB에는 이 migration으로 생성.

-- 채팅방별 최신 메시지 조회 최적화 (messenger unread count + 메시지 목록)
CREATE INDEX IF NOT EXISTS "messages_room_id_created_at_idx"
  ON "messages" ("room_id", "created_at" DESC);

-- 결재자의 대기 문서 조회 최적화 (unread count + 내 결재함)
CREATE INDEX IF NOT EXISTS "approval_lines_approver_status_document_idx"
  ON "approval_lines" ("approver_id", "status", "document_id");

-- 작업지시서 체크리스트 진행률 집계 최적화 (groupBy)
CREATE INDEX IF NOT EXISTS "task_checklists_task_completed_idx"
  ON "task_checklists" ("task_id", "is_completed");

-- 캘린더 이벤트 범위 조회 최적화 (scope별 부서/전사 일정)
CREATE INDEX IF NOT EXISTS "calendar_events_scope_dates_idx"
  ON "calendar_events" ("scope", "start_date", "end_date")
  WHERE "is_active" = true;

-- 결재 문서 상태별 목록 (문서함별 필터)
CREATE INDEX IF NOT EXISTS "approval_documents_drafter_status_created_idx"
  ON "approval_documents" ("drafter_id", "status", "created_at" DESC);
