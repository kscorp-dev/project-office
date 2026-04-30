FROM python:3.11-slim

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# 비루트 유저 생성 (audit 7차 H3 — root 실행 차단)
RUN groupadd --gid 1000 appuser && useradd --uid 1000 --gid 1000 --create-home appuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Download YOLOv8 nano model on build
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# 결과 디렉토리 권한 + 모델 캐시 ownership 변경
RUN mkdir -p /app/results \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8100

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]
