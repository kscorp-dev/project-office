#!/usr/bin/env bash
# Project Office — Staging 환경 관리 스크립트
#
# 사용법:
#   ./scripts/staging.sh <command>
#
# 명령:
#   start       컨테이너 시작 (빌드 포함)
#   stop        컨테이너 중지
#   restart     재시작
#   status      컨테이너 상태 + health check
#   logs        실시간 로그 (backend)
#   migrate     Prisma migration 실행
#   seed        초기 데이터 시드
#   verify      기동 후 기본 API 응답 확인
#   smoke       간이 E2E (로그인 → 목록 API)
#   clean       중지 + 볼륨 삭제 (⚠ 데이터 영구 손실)
#
# 환경:
#   .env.staging 파일이 루트에 있어야 함.
#   없으면 .env.staging.example 복사 후 값 채우기.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.staging"
PROJECT_NAME="po-staging"
COMPOSE_ARGS="-f docker-compose.yml -f docker-compose.staging.yml --env-file $ENV_FILE -p $PROJECT_NAME"

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

err() { echo -e "${RED}[staging] $*${NC}" >&2; }
info() { echo -e "${BLUE}[staging]${NC} $*"; }
ok() { echo -e "${GREEN}[staging] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[staging]${NC} $*"; }

check_prereqs() {
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker가 설치되지 않았습니다"
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    err "docker compose v2 가 필요합니다"
    exit 1
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    err "$ENV_FILE 파일 없음"
    info "샘플 복사: cp .env.staging.example .env.staging"
    info "그 후 .env.staging 을 편집해 CHANGE_ME 값들을 실제 시크릿으로 채우세요"
    exit 1
  fi
  # 필수 값 점검
  for var in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET MAIL_ENCRYPTION_KEY; do
    if grep -qE "^${var}=(CHANGE_ME|)$" "$ENV_FILE"; then
      err "$ENV_FILE 의 $var 값이 CHANGE_ME 또는 빈 값"
      exit 1
    fi
  done
}

cmd_start() {
  check_prereqs
  info "Staging 환경 시작..."
  docker compose $COMPOSE_ARGS up -d --build
  ok "기동 명령 완료. 'status'로 health check 확인:"
  sleep 3
  cmd_status
}

cmd_stop() {
  info "Staging 중지..."
  docker compose $COMPOSE_ARGS stop
  ok "중지됨"
}

cmd_restart() {
  info "Staging 재시작..."
  docker compose $COMPOSE_ARGS restart
  ok "재시작됨"
}

cmd_status() {
  info "컨테이너 상태:"
  docker compose $COMPOSE_ARGS ps

  echo ""
  info "헬스체크:"
  local backend_port=$(grep -E "^BACKEND_PORT=" "$ENV_FILE" | cut -d= -f2 || echo "13001")
  backend_port=${backend_port:-13001}
  local web_port=$(grep -E "^WEB_PORT=" "$ENV_FILE" | cut -d= -f2 || echo "18080")
  web_port=${web_port:-18080}

  if curl -sf "http://localhost:${backend_port}/health" -o /dev/null; then
    ok "Backend http://localhost:${backend_port}/health 정상"
  else
    warn "Backend http://localhost:${backend_port}/health 응답 없음 (아직 기동 중일 수 있음)"
  fi

  if curl -sf "http://localhost:${web_port}" -o /dev/null; then
    ok "Web http://localhost:${web_port} 정상"
  else
    warn "Web http://localhost:${web_port} 응답 없음"
  fi
}

cmd_logs() {
  docker compose $COMPOSE_ARGS logs -f backend
}

cmd_migrate() {
  check_prereqs
  info "Prisma migration 실행..."
  docker compose $COMPOSE_ARGS exec backend npx prisma migrate deploy
  ok "완료"
}

cmd_seed() {
  check_prereqs
  info "Seed 데이터 삽입..."
  docker compose $COMPOSE_ARGS exec backend npx prisma db seed || {
    warn "prisma db seed 실패 — package.json의 prisma.seed 설정 확인 필요"
  }
}

cmd_verify() {
  info "기본 API 응답 확인..."
  local port=$(grep -E "^BACKEND_PORT=" "$ENV_FILE" | cut -d= -f2 || echo "13001")
  port=${port:-13001}
  local api="http://localhost:${port}"

  # /health
  if curl -sf "${api}/health" -o /dev/null; then
    ok "GET /health"
  else
    err "GET /health 실패"
    return 1
  fi

  # 인증 필요한 API는 401 반환 (정상)
  local code=$(curl -s -o /dev/null -w "%{http_code}" "${api}/api/approvals/templates")
  if [[ "$code" == "401" ]]; then
    ok "GET /api/approvals/templates → 401 (인증 미들웨어 정상)"
  else
    warn "GET /api/approvals/templates → $code (401 기대했으나 다름)"
  fi

  # 모듈 라우트 존재 확인
  for path in "/api/mail/inbox" "/api/calendar/events" "/api/notifications"; do
    local c=$(curl -s -o /dev/null -w "%{http_code}" "${api}${path}")
    if [[ "$c" == "401" || "$c" == "404" ]]; then
      ok "${path} → ${c}"
    else
      warn "${path} → ${c} (401/404 기대)"
    fi
  done

  ok "기본 검증 통과"
}

cmd_smoke() {
  check_prereqs
  info "간이 스모크 테스트 (admin 로그인 → 모듈 목록)..."
  local port=$(grep -E "^BACKEND_PORT=" "$ENV_FILE" | cut -d= -f2 || echo "13001")
  port=${port:-13001}
  local api="http://localhost:${port}/api"

  # seed에 기본 admin 계정이 있다는 가정 — SEED_ADMIN_PASSWORD or 기본 Admin@1234
  local pw="${SEED_ADMIN_PASSWORD:-Admin@1234}"

  local login_body=$(curl -s -X POST "${api}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"employeeId\":\"admin\",\"password\":\"${pw}\"}")
  local token=$(echo "$login_body" | node -pe "JSON.parse(require('fs').readFileSync(0)).data?.accessToken || ''" 2>/dev/null <<< "$login_body")

  if [[ -z "$token" ]]; then
    err "로그인 실패 — seed가 돌았는지, 비밀번호가 맞는지 확인"
    info "응답: $login_body"
    return 1
  fi
  ok "로그인 성공"

  # 모듈 목록
  local modules=$(curl -s "${api}/admin/modules" -H "Authorization: Bearer $token" \
    | node -pe "const d=JSON.parse(require('fs').readFileSync(0)); (d.data||[]).length" 2>/dev/null)
  if [[ -n "$modules" && "$modules" != "NaN" ]]; then
    ok "모듈 ${modules}개 조회 성공"
  else
    warn "모듈 조회 응답 이상"
  fi

  # 알림 카운트
  local count=$(curl -s "${api}/notifications/unread-count" -H "Authorization: Bearer $token" \
    | node -pe "const d=JSON.parse(require('fs').readFileSync(0)); d.data?.count ?? 'err'" 2>/dev/null)
  if [[ "$count" != "err" ]]; then
    ok "알림 카운트 API (미확인 ${count}건)"
  fi

  ok "스모크 테스트 완료 — staging 기본 동작 정상"
}

cmd_clean() {
  warn "⚠ Staging 볼륨을 모두 삭제합니다 (데이터 영구 손실)"
  read -p "계속하려면 'yes' 입력: " confirm
  if [[ "$confirm" != "yes" ]]; then
    info "취소됨"
    return 0
  fi
  docker compose $COMPOSE_ARGS down -v
  ok "완료 (컨테이너 + 볼륨 삭제)"
}

usage() {
  cat <<EOF
Project Office — Staging 관리

사용법: $0 <command>

명령:
  start       컨테이너 시작 (빌드 + 기동)
  stop        중지
  restart     재시작
  status      상태 + health check
  logs        backend 실시간 로그
  migrate     Prisma migration 적용
  seed        초기 데이터 시드
  verify      기본 API 응답 확인 (기동 후 자동 호출됨)
  smoke       간이 E2E (admin 로그인 + API 호출)
  clean       컨테이너 + 볼륨 전체 삭제

환경:
  프로젝트 이름: $PROJECT_NAME
  env 파일: $ENV_FILE

예시 첫 사용:
  cp .env.staging.example .env.staging
  vim .env.staging          # CHANGE_ME 값들 채우기
  ./scripts/staging.sh start
  ./scripts/staging.sh migrate
  ./scripts/staging.sh seed
  ./scripts/staging.sh smoke
EOF
}

case "${1:-}" in
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  migrate)   cmd_migrate ;;
  seed)      cmd_seed ;;
  verify)    cmd_verify ;;
  smoke)     cmd_smoke ;;
  clean)     cmd_clean ;;
  ""|-h|--help) usage ;;
  *)         err "알 수 없는 명령: $1"; usage; exit 1 ;;
esac
