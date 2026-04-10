#!/bin/bash
# ── Project Office AWS 초기 설정 스크립트 ──
# EC2 인스턴스에서 실행 (Amazon Linux 2023 / Ubuntu 22.04)
set -euo pipefail

echo "=== Project Office AWS 배포 환경 설정 ==="

# 1. Docker 설치
if ! command -v docker &>/dev/null; then
  echo ">> Docker 설치 중..."
  sudo yum install -y docker 2>/dev/null || sudo apt-get update && sudo apt-get install -y docker.io
  sudo systemctl enable docker && sudo systemctl start docker
  sudo usermod -aG docker $USER
  echo ">> Docker 설치 완료"
fi

# 2. Docker Compose 설치
if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
  echo ">> Docker Compose 설치 중..."
  sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
  echo ">> Docker Compose 설치 완료"
fi

# 3. 프로젝트 디렉토리 생성
PROJECT_DIR="/opt/project-office"
if [ ! -d "$PROJECT_DIR" ]; then
  echo ">> 프로젝트 디렉토리 생성..."
  sudo mkdir -p $PROJECT_DIR
  sudo chown $USER:$USER $PROJECT_DIR
fi

# 4. Git 클론 또는 풀
if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo ">> 레포지토리 클론..."
  git clone https://github.com/kscorp-dev/project-office.git $PROJECT_DIR
else
  echo ">> 최신 코드 가져오기..."
  cd $PROJECT_DIR && git pull origin main
fi

cd $PROJECT_DIR

# 5. .env 파일 생성 (없는 경우)
if [ ! -f .env ]; then
  echo ">> .env 파일 생성 중..."
  cp .env.example .env
  # JWT 시크릿 자동 생성
  JWT_ACCESS=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)
  PG_PASS=$(openssl rand -hex 16)
  sed -i "s/CHANGE_ME_random_64_char_string/$JWT_ACCESS/" .env
  sed -i "0,/CHANGE_ME_random_64_char_string/s//$JWT_REFRESH/" .env
  sed -i "s/CHANGE_ME_strong_password/$PG_PASS/g" .env
  echo ">> .env 파일이 생성되었습니다. 도메인 등 추가 설정을 확인하세요."
fi

# 6. Docker Compose 빌드 및 실행
echo ">> Docker Compose 빌드 및 실행..."
docker compose up -d --build

# 7. DB 시드 (최초 1회)
echo ">> 데이터베이스 시드 실행..."
docker compose exec backend npx prisma db seed 2>/dev/null || echo "시드가 이미 실행되었거나 시드 스크립트가 없습니다."

echo ""
echo "=== 배포 완료! ==="
echo "  Web:     http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_IP'):80"
echo "  Backend: http://localhost:3000"
echo ""
echo "  로그인: admin / Admin@1234"
echo ""
