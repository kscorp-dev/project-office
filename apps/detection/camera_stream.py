"""
카메라 스트림 — MJPEG 직접 스트리밍 + 경량 모션 추적
base64/WebSocket 없이 브라우저 네이티브 MJPEG으로 고FPS 전달
"""
import time
import threading
import subprocess
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional
from enum import Enum

import cv2
import numpy as np

from motion_tracker import MotionTracker
from vehicle_tracker import VehicleTracker


class CameraStatus(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class CameraInfo:
    camera_id: str
    name: str
    url: str
    status: CameraStatus = CameraStatus.DISCONNECTED
    fps: float = 0.0
    frame_count: int = 0
    last_error: str = ""
    resolution: tuple = (0, 0)


class CameraStream:
    """단일 카메라: MJPEG 스트림 + 모션 추적"""

    def __init__(self, camera_id: str, name: str, url: str, is_file: bool = False,
                 yolo_model=None, yolo_device: str = "cpu"):
        self.info = CameraInfo(camera_id=camera_id, name=name, url=url)
        self._cap: Optional[cv2.VideoCapture] = None
        self._running = False
        self._lock = threading.Lock()
        self._is_file = is_file  # 파일/URL 소스 (루프 재생)

        # 최신 JPEG 바이트 (MJPEG 스트리밍용)
        self._latest_jpeg: Optional[bytes] = None
        self._frame_event = threading.Event()

        # 트래커: YOLO 모델이 있으면 VehicleTracker, 없으면 MotionTracker
        if yolo_model is not None:
            self._tracker = VehicleTracker(
                model=yolo_model, device=yolo_device,
                conf=0.15, skip_frames=1,
            )
        else:
            self._tracker = MotionTracker(min_area=600)

        # 캡처 스레드
        self._thread: Optional[threading.Thread] = None

    def connect(self, **kwargs) -> bool:
        if self._running:
            return True

        self.info.status = CameraStatus.CONNECTING
        self.info.last_error = ""

        try:
            self._cap = cv2.VideoCapture(self.info.url)
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            self._cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)

            if not self._cap.isOpened():
                self.info.status = CameraStatus.ERROR
                self.info.last_error = "카메라 연결 실패"
                return False

            w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            self.info.resolution = (w, h)
            self.info.status = CameraStatus.CONNECTED

            if 'min_area' in kwargs:
                self._tracker.min_area = kwargs['min_area']

            self._running = True
            self._thread = threading.Thread(target=self._capture_loop, daemon=True)
            self._thread.start()
            return True

        except Exception as e:
            self.info.status = CameraStatus.ERROR
            self.info.last_error = str(e)
            return False

    def disconnect(self):
        self._running = False
        self._frame_event.set()  # 대기 중인 스트림 해제
        if self._thread:
            self._thread.join(timeout=3)
        if self._cap:
            self._cap.release()
            self._cap = None
        self.info.status = CameraStatus.DISCONNECTED
        self.info.fps = 0.0

    def _capture_loop(self):
        """캡처 → 추적 → JPEG 인코딩 루프"""
        fps_counter = 0
        fps_start = time.time()

        # 파일 소스의 경우 원본 FPS에 맞춰 재생
        source_fps = 0
        frame_delay = 0
        if self._is_file and self._cap:
            source_fps = self._cap.get(cv2.CAP_PROP_FPS)
            if source_fps > 0:
                frame_delay = 1.0 / min(source_fps, 25)  # 최대 25fps

        while self._running:
            if not self._cap or not self._cap.isOpened():
                self.info.status = CameraStatus.ERROR
                self.info.last_error = "스트림 끊김"
                time.sleep(2)
                try:
                    self._cap = cv2.VideoCapture(self.info.url)
                    self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    if self._cap.isOpened():
                        self.info.status = CameraStatus.CONNECTED
                        self.info.last_error = ""
                except Exception:
                    pass
                continue

            ret, frame = self._cap.read()
            if not ret:
                # 파일 소스: 처음으로 되감아 루프 재생
                if self._is_file:
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    self._tracker.reset()
                    time.sleep(0.5)
                    continue
                time.sleep(0.01)
                continue

            fps_counter += 1
            self.info.frame_count += 1
            now = time.time()

            if now - fps_start >= 1.0:
                self.info.fps = round(fps_counter / (now - fps_start), 1)
                fps_counter = 0
                fps_start = now

            # 모션 추적 + 시각화 (경량, 매 프레임)
            result = self._tracker.process_frame(frame)

            # JPEG 인코딩 (품질 낮춰 속도 향상)
            _, buf = cv2.imencode('.jpg', result, [cv2.IMWRITE_JPEG_QUALITY, 60])

            with self._lock:
                self._latest_jpeg = buf.tobytes()
            self._frame_event.set()

            # 파일 소스: FPS에 맞춰 딜레이
            if self._is_file and frame_delay > 0:
                time.sleep(frame_delay)

    def get_jpeg(self) -> Optional[bytes]:
        """최신 JPEG 바이트 반환"""
        with self._lock:
            return self._latest_jpeg

    def generate_mjpeg(self):
        """MJPEG 스트림 제너레이터 (FastAPI StreamingResponse용)"""
        while self._running:
            self._frame_event.wait(timeout=1.0)
            self._frame_event.clear()

            jpeg = self.get_jpeg()
            if jpeg:
                yield (
                    b'--frame\r\n'
                    b'Content-Type: image/jpeg\r\n\r\n' +
                    jpeg +
                    b'\r\n'
                )

    def get_status(self) -> dict:
        return {
            **asdict(self.info),
            "active_objects": self._tracker.active_count,
            "total_trails": self._tracker.trail_count,
        }


class StreamlinkStream(CameraStream):
    """streamlink → ffmpeg pipe → cv2 로 YouTube 라이브 스트림 캡처"""

    def __init__(self, camera_id: str, name: str, url: str, quality: str = "720p,480p,best"):
        super().__init__(camera_id, name, url, is_file=False)
        self._quality = quality
        self._sl_proc: Optional[subprocess.Popen] = None
        self._ff_proc: Optional[subprocess.Popen] = None

    def connect(self, **kwargs) -> bool:
        if self._running:
            return True

        self.info.status = CameraStatus.CONNECTING
        self.info.last_error = ""

        try:
            # streamlink으로 스트림 가용성 확인
            import streamlink as sl
            streams = sl.streams(self.info.url)
            if not streams:
                self.info.status = CameraStatus.ERROR
                self.info.last_error = "사용 가능한 스트림이 없습니다"
                return False

            # 품질 선택
            quality = "best"
            for q in self._quality.split(","):
                q = q.strip()
                if q in streams:
                    quality = q
                    break

            # streamlink 바이너리 경로 (venv 내)
            import shutil, sys
            venv_bin = str(Path(sys.executable).parent)
            sl_bin = shutil.which("streamlink", path=venv_bin) or shutil.which("streamlink") or "streamlink"

            # streamlink stdout → ffmpeg stdin → rawvideo stdout → cv2
            self._sl_proc = subprocess.Popen(
                [
                    sl_bin, "--stdout",
                    "--stream-timeout", "30",
                    "--retry-streams", "3",
                    self.info.url, quality,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            self._ff_proc = subprocess.Popen(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-i", "pipe:0",
                    "-f", "rawvideo", "-pix_fmt", "bgr24",
                    "-vf", "scale=640:360",
                    "-r", "15",
                    "-an", "pipe:1",
                ],
                stdin=self._sl_proc.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            self.info.status = CameraStatus.CONNECTED
            self.info.resolution = (640, 360)  # 예상값, 첫 프레임에서 갱신

            if 'min_area' in kwargs:
                self._tracker.min_area = kwargs['min_area']

            self._running = True
            self._thread = threading.Thread(target=self._pipe_loop, daemon=True)
            self._thread.start()
            return True

        except FileNotFoundError as e:
            # ffmpeg 또는 streamlink 미설치
            self.info.status = CameraStatus.ERROR
            missing = "ffmpeg" if "ffmpeg" in str(e) else "streamlink"
            self.info.last_error = f"{missing}이(가) 설치되지 않았습니다"
            return False
        except Exception as e:
            self.info.status = CameraStatus.ERROR
            self.info.last_error = str(e)
            return False

    def _pipe_loop(self):
        """ffmpeg rawvideo → numpy 프레임 루프"""
        W, H = 640, 360
        frame_size = W * H * 3
        fps_counter = 0
        fps_start = time.time()

        while self._running:
            raw = self._ff_proc.stdout.read(frame_size)
            if not raw or len(raw) < frame_size:
                if self._ff_proc.poll() is not None:
                    break
                time.sleep(0.01)
                continue

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((H, W, 3))

            # 첫 프레임 해상도 갱신
            if self.info.frame_count == 0:
                self.info.resolution = (W, H)

            fps_counter += 1
            self.info.frame_count += 1
            now = time.time()

            if now - fps_start >= 1.0:
                self.info.fps = round(fps_counter / (now - fps_start), 1)
                fps_counter = 0
                fps_start = now

            result = self._tracker.process_frame(frame)
            _, jpeg_buf = cv2.imencode('.jpg', result, [cv2.IMWRITE_JPEG_QUALITY, 60])

            with self._lock:
                self._latest_jpeg = jpeg_buf.tobytes()
            self._frame_event.set()

        self.info.status = CameraStatus.ERROR
        self.info.last_error = "스트림 종료됨"

    def disconnect(self):
        self._running = False
        self._frame_event.set()
        for proc in (self._ff_proc, self._sl_proc):
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
        self._ff_proc = None
        self._sl_proc = None
        if self._thread:
            self._thread.join(timeout=3)
        self.info.status = CameraStatus.DISCONNECTED
        self.info.fps = 0.0


class CameraManager:
    """다중 카메라 관리"""

    def __init__(self, yolo_model=None, yolo_device: str = "cpu"):
        self.cameras: Dict[str, CameraStream] = {}
        self._id_counter = 0
        self._yolo_model = yolo_model
        self._yolo_device = yolo_device

    def add_camera(
        self, ip: str, port: int, name: str = "",
        path: str = "", protocol: str = "rtsp",
        username: str = "", password: str = "",
    ) -> CameraStream:
        self._id_counter += 1
        camera_id = f"cam-{self._id_counter}"

        if not name:
            name = f"카메라 {self._id_counter}"

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

        stream = CameraStream(camera_id, name, url,
                              yolo_model=self._yolo_model, yolo_device=self._yolo_device)
        self.cameras[camera_id] = stream
        return stream

    def add_file_source(self, source: str, name: str = "") -> CameraStream:
        """비디오 파일 또는 URL을 카메라 소스로 추가 (루프 재생)"""
        self._id_counter += 1
        camera_id = f"cam-{self._id_counter}"
        if not name:
            name = f"테스트 영상 {self._id_counter}"

        stream = CameraStream(camera_id, name, source, is_file=True,
                              yolo_model=self._yolo_model, yolo_device=self._yolo_device)
        self.cameras[camera_id] = stream
        return stream

    def add_live_source(self, source: str, name: str = "") -> CameraStream:
        """라이브 스트림 URL을 카메라 소스로 추가 (루프 없음)"""
        self._id_counter += 1
        camera_id = f"cam-{self._id_counter}"
        if not name:
            name = f"라이브 스트림 {self._id_counter}"

        stream = CameraStream(camera_id, name, source, is_file=False,
                              yolo_model=self._yolo_model, yolo_device=self._yolo_device)
        self.cameras[camera_id] = stream
        return stream

    def add_youtube_live(self, url: str, name: str = "", quality: str = "480p,360p,best") -> StreamlinkStream:
        """YouTube 라이브 스트림을 streamlink+ffmpeg으로 추가"""
        self._id_counter += 1
        camera_id = f"cam-{self._id_counter}"
        if not name:
            name = f"YouTube 라이브 {self._id_counter}"

        stream = StreamlinkStream(camera_id, name, url, quality=quality)
        self.cameras[camera_id] = stream
        return stream

    def remove_camera(self, camera_id: str):
        stream = self.cameras.pop(camera_id, None)
        if stream:
            stream.disconnect()

    def get_all_status(self) -> List[dict]:
        return [s.get_status() for s in self.cameras.values()]

    def disconnect_all(self):
        for s in self.cameras.values():
            s.disconnect()
