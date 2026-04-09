#!/bin/bash
# ============================================================
# Project Office — YOLO 주차 감지 서비스 설치 스크립트
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo " Project Office — Parking Detection Setup"
echo " YOLOv8 Nano + FastAPI"
echo "============================================"
echo ""

# 1. Python 버전 확인
PYTHON=""
for cmd in python3.11 python3.10 python3.12 python3; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON="$cmd"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "[ERROR] Python 3.10+ 이 필요합니다."
  echo "  macOS: brew install python@3.11"
  echo "  Ubuntu: sudo apt install python3.11 python3.11-venv"
  exit 1
fi

PY_VER=$($PYTHON --version 2>&1)
echo "[1/4] Python: $PY_VER"

# 2. 가상환경 생성
if [ ! -d "venv" ]; then
  echo "[2/4] 가상환경 생성 중..."
  $PYTHON -m venv venv
else
  echo "[2/4] 기존 가상환경 사용"
fi

# 활성화
source venv/bin/activate

# 3. 의존성 설치
echo "[3/4] 패키지 설치 중... (ultralytics, fastapi, opencv)"
pip install --upgrade pip -q
pip install -r requirements.txt -q

# 4. YOLO 모델 다운로드
echo "[4/4] YOLOv8 Nano 모델 다운로드..."
python -c "
from ultralytics import YOLO
import shutil
from pathlib import Path

model_path = Path('models/yolov8n.pt')
if not model_path.exists():
    model = YOLO('yolov8n')
    default = Path('yolov8n.pt')
    if default.exists():
        model_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(default), str(model_path))
    print(f'Model saved to {model_path}')
else:
    print(f'Model already exists at {model_path}')
"

echo ""
echo "============================================"
echo " 설치 완료!"
echo ""
echo " 서버 실행:"
echo "   cd apps/detection"
echo "   source venv/bin/activate"
echo "   python app.py"
echo ""
echo " 또는 프로젝트 루트에서:"
echo "   npm run dev:detection"
echo ""
echo " API 문서: http://localhost:8200/docs"
echo "============================================"
