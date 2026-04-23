-- 사용자 삭제 시 orphan 레코드 방지: SET NULL 정책 적용
-- (해당 User가 삭제되어도 Message/ChatRoom은 보존되고 senderId/creatorId만 NULL로)

-- chat_rooms.creator_id → users.id
ALTER TABLE "chat_rooms" DROP CONSTRAINT IF EXISTS "chat_rooms_creator_id_fkey";
ALTER TABLE "chat_rooms"
  ADD CONSTRAINT "chat_rooms_creator_id_fkey"
  FOREIGN KEY ("creator_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- messages.sender_id → users.id
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_id_fkey";
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- messages.parent_id → messages.id (답장 원본이 삭제되어도 답장 보존)
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_parent_id_fkey";
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
