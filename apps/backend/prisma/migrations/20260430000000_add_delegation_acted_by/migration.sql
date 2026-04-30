-- 결재 위임/대결 — ApprovalLine.actedByUserId 추가
-- (line.approverId 는 원래 결재자 유지, actedByUserId 는 실제 처리한 위임 받은 사람)
ALTER TABLE "approval_lines"
  ADD COLUMN "acted_by_user_id" TEXT;

CREATE INDEX "approval_lines_acted_by_user_id_idx"
  ON "approval_lines"("acted_by_user_id");

ALTER TABLE "approval_lines"
  ADD CONSTRAINT "approval_lines_acted_by_user_id_fkey"
  FOREIGN KEY ("acted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
