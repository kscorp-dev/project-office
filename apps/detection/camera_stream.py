"""
카메라 스트림 관리 — RTSP/HTTP 카메라에서 실시간 프레임 캡처 + YOLO 추론
"""
import time
import threading
import base64
from dataclasses import dataclass, field, asdict
from typing import Optional
from enum import Enum

import cv2
import numpy as np

from detector import ParkingDetector


class CameraStatus(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class CameraInfo:
    camera_id: str
    name: str
    url: str             # full stream URL
    status: CameraStatus = CameraStatus.DISCONNECTED
    fps: float = 0.0
    frame_count: int = 0
    last_error: str = ""
    resolution: tuple = (0, 0)


class CameraStream:
    """단일 카메라 스트림 캡처 + 감지 스레드"""

    def __init__(self, camera_id: str, name: str, url: str, detector: ParkingDetector):
        self.info = CameraInfo(camera_id=camera_id, name=name, url=url)
        self.detector = detector
        self._cap: Optional[cv2.VideoCapture] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lock = threading.Lock()

        # 최신 프레임/결과 (스레드 안전)
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_result: Optional[dict] = None
        self._latest_frame_b64: str = ""
        self._detect_interval: float = 1.0  # 감지 주기 (초)
        self._confidence: float = 0.35

    def connect(self, detect_interval: float = 1.0, confidence: float = 0.35) -> bool:
        """카메라 연결 시작"""
        if self._running:
            return True

        self._detect_interval = detect_interval
        self._confidence = confidence
        self.info.status = CameraStatus.CONNECTING
        self.info.last_error = ""

        try:
            self._cap = cv2.VideoCapture(self.info.url)
            # 타임아웃 설정
            self._cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)
            self._cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)

            if not self._cap.isOpened():
                self.info.status = CameraStatus.ERROR
                self.info.last_error = "카메라 연결 실패: 스트림을 열 수 없습니다."
                return False

            w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            self.info.resolution = (w, h)
            self.info.status = CameraStatus.CONNECTED

            self._running = True
            self._thread = threading.Thread(target=self._capture_loop, daemon=True)
            self._thread.start()
            return True

        except Exception as e:
            self.info.status = CameraStatus.ERROR
            self.info.last_error = f"연결 오류: {str(e)}"
            return False

    def disconnect(self):
        """카메라 연결 해제"""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        if self._cap:
            self._cap.release()
            self._cap = None
        self.info.status = CameraStatus.DISCONNECTED
        self.info.fps = 0.0
        with self._lock:
            self._latest_frame = None
            self._latest_result = None
            self._latest_frame_b64 = ""

    def _capture_loop(self):
        """프레임 캡처 + 주기적 감지 루프 (백그라운드 스레드)"""
        last_detect_time = 0
        fps_counter = 0
        fps_start = time.time()

        while self._running:
            if not self._cap or not self._cap.isOpened():
                self.info.status = CameraStatus.ERROR
                self.info.last_error = "스트림 연결이 끊어졌습니다."
                # 재연결 시도
                time.sleep(2)
                try:
                    self._cap = cv2.VideoCapture(self.info.url)
                    if self._cap.isOpened():
                        self.info.status = CameraStatus.CONNECTED
                        self.info.last_error = ""
                        continue
                except Exception:
                    pass
                continue

            ret, frame = self._cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            fps_counter += 1
            self.info.frame_count += 1
            now = time.time()

            # FPS 계산 (1초마다)
            if now - fps_start >= 1.0:
                self.info.fps = round(fps_counter / (now - fps_start), 1)
                fps_counter = 0
                fps_start = now

            # 감지 주기에 맞춰 YOLO 실행
            if now - last_detect_time >= self._detect_interval:
                last_detect_time = now
                result = self.detector.detect(
                    frame,
                    conf=self._confidence,
                    save_result=False,
                )
                # 결과 이미지 생성 (바운딩박스 오버레이)
                annotated = self._annotate_frame(frame, result)

                # JPEG 인코딩 → base64
                _, buf = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
                b64 = base64.b64encode(buf).decode('utf-8')

                with self._lock:
                    self._latest_frame = frame
                    self._latest_result = result
                    self._latest_frame_b64 = f"data:image/jpeg;base64,{b64}"

            # CPU 과부하 방지
            time.sleep(0.03)

    def _annotate_frame(self, frame: np.ndarray, result: dict) -> np.ndarray:
        """프레임에 감지 결과 오버레이"""
        img = frame.copy()
        h, w = img.shape[:2]

        ZONE_COLORS = {"A": (245, 130, 59), "B": (94, 197, 34), "C": (8, 179, 234)}

        # 구역 영역 (반투명)
        overlay = img.copy()
        for zone_cfg in self.detector.mapper.zones:
            color = ZONE_COLORS.get(zone_cfg.zone_id, (200, 200, 200))
            zx1, zy1 = int(zone_cfg.x1 * w), int(zone_cfg.y1 * h)
            zx2, zy2 = int(zone_cfg.x2 * w), int(zone_cfg.y2 * h)
            cv2.rectangle(overlay, (zx1, zy1), (zx2, zy2), color, -1)
        cv2.addWeighted(overlay, 0.08, img, 0.92, 0, img)

        # 구역 라벨
        for zone_cfg in self.detector.mapper.zones:
            color = ZONE_COLORS.get(zone_cfg.zone_id, (200, 200, 200))
            zx1, zy1 = int(zone_cfg.x1 * w), int(zone_cfg.y1 * h)
            zx2, zy2 = int(zone_cfg.x2 * w), int(zone_cfg.y2 * h)
            cv2.rectangle(img, (zx1, zy1), (zx2, zy2), color, 2)

            zone_summary = result.get("zone_summary", {}).get(zone_cfg.zone_id, {})
            occ = zone_summary.get("occupied", 0)
            total = zone_summary.get("total", 0)
            label = f"{zone_cfg.zone_id} ({occ}/{total})"
            cv2.putText(img, label, (zx1 + 6, zy1 + 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        # 차량 바운딩박스
        vehicles = result.get("vehicles", [])
        for v in vehicles:
            bbox = v.get("bbox_px")
            if not bbox:
                continue
            bx1, by1, bx2, by2 = bbox
            zone_id = v.get("zone") or "?"
            spot = v.get("spot_label") or "?"
            conf = v.get("confidence", 0)
            color = ZONE_COLORS.get(zone_id, (200, 200, 200))

            cv2.rectangle(img, (bx1, by1), (bx2, by2), color, 2)
            tag = f"{spot} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(img, (bx1, by1 - th - 6), (bx1 + tw + 6, by1), color, -1)
            cv2.putText(img, tag, (bx1 + 3, by1 - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        # 상태 바
        ts = time.strftime("%H:%M:%S")
        info_text = f"LIVE | {ts} | {len(vehicles)} vehicles | {self.info.fps} FPS"
        cv2.rectangle(img, (0, h - 30), (w, h), (0, 0, 0), -1)
        cv2.putText(img, info_text, (8, h - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 100), 1)

        return img

    def get_latest(self) -> dict:
        """최신 프레임 + 감지 결과 반환"""
        with self._lock:
            return {
                "camera": asdict(self.info),
                "frame": self._latest_frame_b64,
                "detection": self._latest_result,
            }


class CameraManager:
    """다중 카메라 관리"""

    def __init__(self, detector: ParkingDetector):
        self.detector = detector
        self.cameras: dict[str, CameraStream] = {}
        self._id_counter = 0

    def add_camera(
        self, ip: str, port: int, name: str = "",
        path: str = "", protocol: str = "rtsp",
        username: str = "", password: str = "",
    ) -> CameraStream:
        """카메라 추가"""
        self._id_counter += 1
        camera_id = f"cam-{self._id_counter}"

        if not name:
            name = f"주차장 카메라 {self._id_counter}"

        # URL 생성
        if protocol == "rtsp":
            auth = f"{username}:{password}@" if username else ""
            stream_path = path or "/stream"
            url = f"rtsp://{auth}{ip}:{port}{stream_path}"
        elif protocol == "http":
            auth = f"{username}:{password}@" if username else ""
            stream_path = path or "/video"
            url = f"http://{auth}{ip}:{port}{stream_path}"
        else:
            url = f"{protocol}://{ip}:{port}{path}"

        stream = CameraStream(camera_id, name, url, self.detector)
        self.cameras[camera_id] = stream
        return stream

    def connect_camera(
        self, camera_id: str,
        detect_interval: float = 1.0,
        confidence: float = 0.35,
    ) -> bool:
        """카메라 연결 시작"""
        stream = self.cameras.get(camera_id)
        if not stream:
            return False
        return stream.connect(detect_interval, confidence)

    def disconnect_camera(self, camera_id: str):
        """카메라 연결 해제"""
        stream = self.cameras.get(camera_id)
        if stream:
            stream.disconnect()

    def remove_camera(self, camera_id: str):
        """카메라 삭제"""
        stream = self.cameras.pop(camera_id, None)
        if stream:
            stream.disconnect()

    def get_all_status(self) -> list[dict]:
        """모든 카메라 상태"""
        return [asdict(s.info) for s in self.cameras.values()]

    def get_latest(self, camera_id: str) -> Optional[dict]:
        """특정 카메라의 최신 프레임 + 결과"""
        stream = self.cameras.get(camera_id)
        if not stream:
            return None
        return stream.get_latest()

    def disconnect_all(self):
        """모든 카메라 해제"""
        for stream in self.cameras.values():
            stream.disconnect()
