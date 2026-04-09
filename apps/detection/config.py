"""
주차장 감지 서비스 설정
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).parent

# YOLO 모델 설정
MODEL_PATH = BASE_DIR / "models" / "yolov8s.pt"
MODEL_NAME = "yolov8s"  # YOLOv8 Small (더 높은 정확도)
CONFIDENCE_THRESHOLD = 0.15  # 낮춰서 원거리/고속 차량도 감지
IOU_THRESHOLD = 0.5

# 차량 클래스 (COCO dataset)
VEHICLE_CLASSES = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    1: "bicycle",
}

# 서버 설정
HOST = os.getenv("DETECTION_HOST", "0.0.0.0")
PORT = int(os.getenv("DETECTION_PORT", "8200"))

# 파일 경로
UPLOAD_DIR = BASE_DIR / "uploads"
RESULT_DIR = BASE_DIR / "results"
ZONE_CONFIG_DIR = BASE_DIR / "zones"

# 기본 주차장 이미지 해상도 (참조용)
DEFAULT_IMAGE_WIDTH = 1280
DEFAULT_IMAGE_HEIGHT = 720
