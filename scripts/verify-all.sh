#!/usr/bin/env bash
# Project Office 전체 검증 스크립트
# 사용법: ./scripts/verify-all.sh [--skip-tests]
#
# 확인 항목 (종료 코드 0=통과, 1=실패):
#   1. Node/npm/프로젝트 루트 위치
#   2. apps/{backend,web,mobile} 의존성 설치 상태
#   3. TypeScript 타입체크 (3종)
#   4. Backend Vitest 테스트 (--skip-tests로 스킵 가능)
#   5. Prisma migration 상태 (PostgreSQL 접속 필요)
#   6. 필수 환경변수 설정 여부 (JWT, DB 등)
#   7. 버전 일관성 (루트 vs apps/*)

set -euo pipefail

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ── 플래그 ──
SKIP_TESTS=false
for arg in "$@"; do
  case $arg in
    --skip-tests) SKIP_TESTS=true; shift ;;
  esac
done

# ── 통계 ──
PASS=0
FAIL=0
WARN=0
FAILURES=()

section() {
  echo ""
  echo -e "${BOLD}${BLUE}▸ $1${NC}"
}

pass() {
  echo -e "  ${GREEN}✓${NC} $1"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "  ${RED}✗${NC} $1"
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
}

warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
  WARN=$((WARN + 1))
}

# ── 실행 위치 확인 ──
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f package.json || ! -d apps ]]; then
  echo "스크립트를 project-office 루트에서 실행해야 합니다."
  exit 1
fi

echo -e "${BOLD}Project Office 전체 검증${NC}"
echo "루트: $ROOT_DIR"
echo "시작: $(date +'%Y-%m-%d %H:%M:%S')"

# ── 1. 기본 툴체인 ──
section "1. 기본 툴체인"

if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version)
  pass "Node.js $NODE_VER"
  # 20 이상인지
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\)\..*/\1/')
  if [[ $NODE_MAJOR -lt 20 ]]; then
    warn "Node.js 20+ 권장 (현재 $NODE_VER)"
  fi
else
  fail "Node.js 미설치"
fi

if command -v npm >/dev/null 2>&1; then
  pass "npm $(npm --version)"
else
  fail "npm 미설치"
fi

# ── 2. 의존성 ──
section "2. 의존성 설치 상태"

for pkg in backend web mobile; do
  if [[ -d "apps/$pkg/node_modules" ]] || [[ -d "node_modules/$pkg" ]] || [[ -L "apps/$pkg/node_modules" ]]; then
    pass "apps/$pkg node_modules"
  else
    # workspace hoisting 확인 — 루트에 설치되었을 수 있음
    if [[ -d "node_modules" ]] && [[ -f "apps/$pkg/package.json" ]]; then
      warn "apps/$pkg node_modules 없음 (루트 workspace hoisting 가능 — 'npm install'로 확인)"
    else
      fail "apps/$pkg 의존성 미설치 — 'npm install' 필요"
    fi
  fi
done

# ── 3. 버전 일관성 ──
section "3. 버전 일관성"

ROOT_VER=$(node -p "require('./package.json').version")
for pkg in backend web mobile; do
  PKG_VER=$(node -p "require('./apps/$pkg/package.json').version")
  if [[ "$ROOT_VER" == "$PKG_VER" ]]; then
    pass "apps/$pkg@$PKG_VER (루트 = $ROOT_VER)"
  else
    warn "apps/$pkg 버전 불일치: $PKG_VER vs 루트 $ROOT_VER"
  fi
done

# ── 4. 타입체크 ──
section "4. TypeScript 타입체크"

for pkg in backend web mobile; do
  pushd "apps/$pkg" >/dev/null
  if npx tsc --noEmit 2>/dev/null; then
    pass "apps/$pkg tsc --noEmit"
  else
    fail "apps/$pkg tsc 실패 — 'cd apps/$pkg && npx tsc --noEmit' 확인"
  fi
  popd >/dev/null
done

# ── 5. Backend 테스트 ──
if ! $SKIP_TESTS; then
  section "5. Backend Vitest"

  pushd apps/backend >/dev/null
  # DISABLE_PUSH로 외부 의존성 제거, verbose=false로 요약만
  if DISABLE_PUSH=true npx vitest run --reporter=default 2>&1 | tee /tmp/po-vitest.log | tail -20; then
    # 마지막 줄에 Tests   N passed 확인
    if grep -qE "Tests\s+[0-9]+\s+passed" /tmp/po-vitest.log; then
      TEST_COUNT=$(grep -oE "Tests\s+[0-9]+\s+passed" /tmp/po-vitest.log | head -1 | grep -oE "[0-9]+")
      pass "Backend 테스트 ${TEST_COUNT}건 통과"
    else
      fail "Backend 테스트 요약을 파싱할 수 없음 — /tmp/po-vitest.log 확인"
    fi
  else
    fail "Backend 테스트 실패 — /tmp/po-vitest.log 확인"
  fi
  popd >/dev/null
else
  section "5. Backend Vitest (--skip-tests, 스킵)"
fi

# ── 6. Prisma migration 상태 ──
section "6. Prisma migration 상태"

pushd apps/backend >/dev/null
if [[ ! -f .env ]] && [[ -z "${DATABASE_URL:-}" ]]; then
  warn ".env 및 DATABASE_URL 없음 — migration 상태 검사 스킵"
else
  MIGRATE_OUT=$(npx prisma migrate status 2>&1 || true)
  if echo "$MIGRATE_OUT" | grep -qE "Database schema is up to date"; then
    MIGRATE_COUNT=$(echo "$MIGRATE_OUT" | grep -oE "[0-9]+ migrations found" | grep -oE "[0-9]+")
    pass "Prisma ${MIGRATE_COUNT}개 migration 모두 적용됨"
  elif echo "$MIGRATE_OUT" | grep -qE "Following migrations have not yet been applied"; then
    fail "미적용 migration 있음 — 'npx prisma migrate deploy' 실행 필요"
  else
    warn "Prisma status 결과를 해석할 수 없음 — DB 접속 확인"
  fi
fi
popd >/dev/null

# ── 7. 필수 환경변수 (backend) ──
section "7. 백엔드 필수 환경변수"

if [[ -f apps/backend/.env ]]; then
  for var in JWT_ACCESS_SECRET JWT_REFRESH_SECRET DATABASE_URL; do
    if grep -qE "^$var=.+" apps/backend/.env; then
      pass "$var 설정됨"
    else
      fail "$var 미설정 (apps/backend/.env)"
    fi
  done

  # 선택적 (미설정이어도 앱 작동하지만 기능 제한)
  for var in ANTHROPIC_API_KEY SYSTEM_MAIL_SMTP_HOST EXPO_ACCESS_TOKEN GOOGLE_OAUTH_CLIENT_ID CCTV_FFMPEG_PATH; do
    if grep -qE "^$var=.+$" apps/backend/.env; then
      pass "$var 설정됨 (선택)"
    else
      warn "$var 미설정 — 해당 기능 비활성화 상태"
    fi
  done
else
  warn "apps/backend/.env 없음 — .env.example 참고해 생성"
fi

# ── 8. 빌드 가능 여부 (간단히 backend만) ──
section "8. 빌드 가능 여부"

pushd apps/backend >/dev/null
if npm run build --silent >/dev/null 2>&1; then
  pass "Backend 빌드 성공"
else
  fail "Backend 빌드 실패 — 'cd apps/backend && npm run build' 확인"
fi
popd >/dev/null

# ── 요약 ──
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}검증 요약${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}통과: $PASS${NC}"
echo -e "${YELLOW}경고: $WARN${NC}"
echo -e "${RED}실패: $FAIL${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}${BOLD}실패 항목:${NC}"
  for msg in "${FAILURES[@]}"; do
    echo -e "  ${RED}-${NC} $msg"
  done
  echo ""
  echo -e "${RED}❌ 검증 실패 ($FAIL건)${NC}"
  exit 1
fi

if [[ $WARN -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}⚠ 통과했지만 경고 ${WARN}건 — 프로덕션 배포 전 확인 권장${NC}"
else
  echo ""
  echo -e "${GREEN}✅ 모든 검증 통과${NC}"
fi

echo ""
echo -e "${BLUE}수동 확인 필요:${NC} docs/release-verification.md"
exit 0
