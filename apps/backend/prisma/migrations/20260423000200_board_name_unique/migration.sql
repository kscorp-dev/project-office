-- Board.name에 UNIQUE 제약 추가
-- seed.ts의 잘못된 upsert로 생긴 중복 행을 먼저 정리한 뒤 제약을 건다.

-- 1) 각 name별로 가장 오래된 board_id를 keeper로 식별
-- 2) 중복 행의 posts를 keeper board_id로 재지정
-- 3) 중복 행 삭제
WITH keepers AS (
  SELECT DISTINCT ON (name) id, name
  FROM boards
  ORDER BY name, created_at ASC
)
UPDATE posts p
SET board_id = k.id
FROM keepers k
INNER JOIN boards b ON b.name = k.name
WHERE p.board_id = b.id AND b.id <> k.id;

DELETE FROM boards b
WHERE b.id NOT IN (
  SELECT DISTINCT ON (name) id FROM boards ORDER BY name, created_at ASC
);

-- 4) UNIQUE 제약 추가
CREATE UNIQUE INDEX "boards_name_key" ON "boards"("name");
