"""
YOLOv8 Small 기반 차량 감지 엔진
Apple Silicon MPS 가속 지원
"""
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
from PIL import Image
from ultralytics import YOLO

from config import (
    MODEL_PATH, MODEL_NAME, CONFIDENCE_THRESHOLD,
    IOU_THRESHOLD, VEHICLE_CLASSES, RESULT_DIR,
)
from zone_mapper import ZoneMapper


def _get_device() -> str:
    """사용 가능한 최적 디바이스 반환"""
    if torch.backends.mps.is_available():
        return "mps"  # Apple Silicon GPU
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class ParkingDetector:
    """주차장 차량 감지 + 구역 매핑"""

    def __init__(self, zone_config_path: Optional[str] = None):
        self.model: Optional[YOLO] = None
        self.device = _get_device()
        self.mapper = ZoneMapper(config_path=zone_config_path)
        self._load_model()

    def _load_model(self):
        """YOLO 모델 로드 (없으면 자동 다운로드) + GPU 설정"""
        if MODEL_PATH.exists():
            self.model = YOLO(str(MODEL_PATH))
        else:
            MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.model = YOLO(MODEL_NAME)
            import shutil
            default_path = Path(MODEL_NAME + ".pt")
            if default_path.exists():
                shutil.move(str(default_path), str(MODEL_PATH))
        self.model.to(self.device)
        print(f"[ParkingDetector] Model loaded: {MODEL_NAME} on {self.device}")

    def detect(
        self,
        image_source,
        conf: float = CONFIDENCE_THRESHOLD,
        save_result: bool = False,
        result_name: Optional[str] = None,
    ) -> dict:
        """
        이미지에서 차량 감지 후 구역 매핑 결과 반환

        Args:
            image_source: 파일 경로(str/Path), numpy array, 또는 PIL Image
            conf: 감지 신뢰도 임계값
            save_result: 결과 이미지 저장 여부
            result_name: 결과 파일명

        Returns:
            {
                "success": True,
                "elapsed_ms": 123,
                "image_size": [1280, 720],
                "total_detected": 5,
                "zone_summary": {...},
                "vehicles": [...],
                "spots": [...],
                "result_image": "path/to/result.jpg" (if save_result)
            }
        """
        start = time.time()

        # 이미지 로드
        if isinstance(image_source, (str, Path)):
            img = cv2.imread(str(image_source))
        elif isinstance(image_source, Image.Image):
            img = cv2.cvtColor(np.array(image_source), cv2.COLOR_RGB2BGR)
        elif isinstance(image_source, np.ndarray):
            img = image_source
        else:
            return {"success": False, "error": "Invalid image source"}

        if img is None:
            return {"success": False, "error": "Failed to load image"}

        h, w = img.shape[:2]

        # YOLO 추론 (GPU 가속)
        results = self.model(
            img,
            conf=conf,
            iou=IOU_THRESHOLD,
            classes=list(VEHICLE_CLASSES.keys()),
            device=self.device,
            verbose=False,
        )

        # 감지 결과 파싱
        detections = []
        boxes = results[0].boxes

        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])

            # 정규화 좌표 (0~1)
            cx = ((x1 + x2) / 2) / w
            cy = ((y1 + y2) / 2) / h
            bw = (x2 - x1) / w
            bh = (y2 - y1) / h

            detections.append({
                "cx": round(cx, 4),
                "cy": round(cy, 4),
                "w": round(bw, 4),
                "h": round(bh, 4),
                "conf": round(confidence, 3),
                "class": VEHICLE_CLASSES.get(cls_id, "unknown"),
                "bbox_px": [int(x1), int(y1), int(x2), int(y2)],
            })

        # 구역 매핑
        mapping = self.mapper.map_detections(detections)
        elapsed = round((time.time() - start) * 1000, 1)

        result = {
            "success": True,
            "elapsed_ms": elapsed,
            "image_size": [w, h],
            **mapping,
        }

        # 결과 이미지 저장 (바운딩박스 + 구역 오버레이)
        if save_result:
            result_path = self._draw_result(img, detections, mapping, result_name)
            result["result_image"] = str(result_path)

        return result

    def _draw_result(
        self, img: np.ndarray, detections: list, mapping: dict,
        name: Optional[str] = None,
    ) -> Path:
        """감지 결과를 이미지에 그리기"""
        h, w = img.shape[:2]
        overlay = img.copy()

        ZONE_COLORS = {"A": (245, 130, 59), "B": (94, 197, 34), "C": (8, 179, 234)}

        # 구역 영역 그리기
        for zone_cfg in self.mapper.zones:
            color = ZONE_COLORS.get(zone_cfg.zone_id, (200, 200, 200))
            zx1, zy1 = int(zone_cfg.x1 * w), int(zone_cfg.y1 * h)
            zx2, zy2 = int(zone_cfg.x2 * w), int(zone_cfg.y2 * h)
            cv2.rectangle(overlay, (zx1, zy1), (zx2, zy2), color, 2)
            cv2.putText(overlay, f"{zone_cfg.zone_id}", (zx1 + 8, zy1 + 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

        # 차량 바운딩박스
        for i, det in enumerate(detections):
            bx1, by1, bx2, by2 = det["bbox_px"]
            vehicle = mapping["vehicles"][i]
            zone_id = vehicle.get("zone", "?")
            spot_label = vehicle.get("spot_label", "?")
            conf = det["conf"]

            color = ZONE_COLORS.get(zone_id, (200, 200, 200))
            cv2.rectangle(overlay, (bx1, by1), (bx2, by2), color, 2)

            label = f"{spot_label} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(overlay, (bx1, by1 - th - 8), (bx1 + tw + 8, by1), color, -1)
            cv2.putText(overlay, label, (bx1 + 4, by1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        fname = name or f"result_{int(time.time())}.jpg"
        result_path = RESULT_DIR / fname
        cv2.imwrite(str(result_path), overlay)
        return result_path

    def track(
        self,
        frame: np.ndarray,
        conf: float = CONFIDENCE_THRESHOLD,
        tracker: str = "bytetrack.yaml",
    ) -> dict:
        """
        프레임에서 차량 추적 (ByteTrack) — 트랙 ID 포함 결과 반환

        Returns:
            {
                "success": True,
                "elapsed_ms": 45.2,
                "image_size": [w, h],
                "total_detected": 3,
                "zone_summary": {...},
                "vehicles": [{ ..., "track_id": 5 }, ...],
                "spots": [...]
            }
        """
        start = time.time()
        h, w = frame.shape[:2]

        results = self.model.track(
            frame,
            conf=conf,
            iou=IOU_THRESHOLD,
            classes=list(VEHICLE_CLASSES.keys()),
            device=self.device,
            tracker=tracker,
            persist=True,
            verbose=False,
        )

        detections = []
        boxes = results[0].boxes

        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])
            track_id = int(box.id[0]) if box.id is not None else -1

            cx = ((x1 + x2) / 2) / w
            cy = ((y1 + y2) / 2) / h
            bw = (x2 - x1) / w
            bh = (y2 - y1) / h

            detections.append({
                "cx": round(cx, 4),
                "cy": round(cy, 4),
                "w": round(bw, 4),
                "h": round(bh, 4),
                "conf": round(confidence, 3),
                "class": VEHICLE_CLASSES.get(cls_id, "unknown"),
                "bbox_px": [int(x1), int(y1), int(x2), int(y2)],
                "track_id": track_id,
            })

        mapping = self.mapper.map_detections(detections)
        # track_id를 vehicles에 전파
        for i, v in enumerate(mapping.get("vehicles", [])):
            v["track_id"] = detections[i]["track_id"]

        elapsed = round((time.time() - start) * 1000, 1)

        return {
            "success": True,
            "elapsed_ms": elapsed,
            "image_size": [w, h],
            **mapping,
        }

    def detect_from_bytes(self, image_bytes: bytes, **kwargs) -> dict:
        """바이트 데이터에서 감지"""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"success": False, "error": "Failed to decode image bytes"}
        return self.detect(img, **kwargs)

    def get_zone_status(self) -> dict:
        """현재 구역 설정 반환 (감지 없이)"""
        return {
            "zones": self.mapper.get_zone_configs(),
            "spots": [
                {
                    "zone": s.zone,
                    "spot_number": s.spot_number,
                    "label": s.label,
                    "x1": s.x1, "y1": s.y1,
                    "x2": s.x2, "y2": s.y2,
                }
                for s in self.mapper.spots
            ],
        }
