"""
YOLO + ByteTrack 기반 차량 트래커
MOG2 대신 YOLOv8로 차량만 정확히 감지 + ByteTrack으로 안정적 추적
"""
import time
import threading
import requests
from collections import deque
from typing import Dict, List, Tuple, Optional

import cv2
import numpy as np

from plate_reader import PlateReader

# 차량 클래스 설정
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck", 1: "bicycle"}

# 클래스별 색상 (BGR)
CLASS_COLORS = {
    "car":        (80, 200, 80),    # 초록
    "truck":      (80, 140, 255),   # 주황
    "bus":        (255, 140, 60),   # 파랑
    "motorcycle": (180, 80, 255),   # 보라
    "bicycle":    (80, 220, 255),   # 노랑
    "unknown":    (180, 180, 180),  # 회색
}

# 클래스별 한글 라벨
CLASS_LABELS = {
    "car": "승용차", "truck": "트럭", "bus": "버스",
    "motorcycle": "오토바이", "bicycle": "자전거",
}


class VehicleTracker:
    """
    YOLOv8 + ByteTrack 차량 추적기
    - YOLO로 차량만 감지 (car, truck, bus, motorcycle, bicycle)
    - ByteTrack으로 프레임 간 ID 유지
    - 경로 기록 + 입출차 라인 교차 감지
    """

    def __init__(
        self,
        model=None,
        device: str = "cpu",
        conf: float = 0.15,
        iou: float = 0.5,
        max_disappeared: int = 30,
        trail_length: int = 200,
        skip_frames: int = 0,
    ):
        self.model = model
        self.device = device
        self.conf = conf
        self.iou = iou
        self.max_disappeared = max_disappeared
        self.trail_length = trail_length
        self.skip_frames = skip_frames

        # 추적 상태
        self._trails: Dict[int, deque] = {}
        self._classes: Dict[int, str] = {}
        self._confs: Dict[int, float] = {}
        self._bboxes: Dict[int, Tuple] = {}
        self._last_seen: Dict[int, float] = {}
        self._speeds: Dict[int, float] = {}

        # 프레임 카운터
        self._frame_count = 0

        # 통계
        self.active_count = 0
        self.trail_count = 0
        self._class_counts: Dict[str, int] = {}

        # 번호판 인식기
        self._plate_reader = PlateReader()
        self._ocr_interval = 15
        self._ocr_counter = 0

        # 입출차 설정
        self._lines: List[Dict] = []
        self._zones: List[Dict] = []
        self._crossed: Dict[int, set] = {}
        self._webhook_url: Optional[str] = None
        self._camera_id: Optional[str] = None
        self._event_queue: List[Dict] = []
        self._max_events = 50

        # 추론 잠금 (GPU 동시 접근 방지)
        self._infer_lock = threading.Lock()

    @property
    def min_area(self):
        return 0  # YOLO 기반이므로 미사용

    @min_area.setter
    def min_area(self, val):
        pass

    def reset(self):
        """트래커 상태 초기화"""
        self._trails.clear()
        self._classes.clear()
        self._confs.clear()
        self._bboxes.clear()
        self._last_seen.clear()
        self._speeds.clear()
        self._crossed.clear()
        self._frame_count = 0
        self.active_count = 0
        self.trail_count = 0
        self._class_counts.clear()
        # ByteTrack 내부 상태도 리셋하기 위해 모델 tracker를 reset
        if self.model:
            self.model.predictor = None

    # ==================================================================
    # 구역/라인 설정 (MotionTracker와 동일 인터페이스)
    # ==================================================================
    def set_lines(self, lines: List[Dict]):
        self._lines = lines

    def set_zones(self, zones: List[Dict]):
        self._zones = zones

    def set_webhook(self, url: str, camera_id: str):
        self._webhook_url = url
        self._camera_id = camera_id

    def get_recent_events(self) -> List[Dict]:
        return list(self._event_queue)

    # ==================================================================
    # 메인 처리
    # ==================================================================
    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """프레임 → YOLO 감지 + ByteTrack 추적 + 시각화"""
        self._frame_count += 1
        h, w = frame.shape[:2]
        now = time.time()

        # skip_frames: N프레임마다 추론 (부하 절감)
        run_inference = (self.skip_frames == 0 or
                         self._frame_count % (self.skip_frames + 1) == 0)

        if run_inference and self.model is not None:
            with self._infer_lock:
                results = self.model.track(
                    frame,
                    conf=self.conf,
                    iou=self.iou,
                    classes=list(VEHICLE_CLASSES.keys()),
                    device=self.device,
                    tracker="bytetrack.yaml",
                    persist=True,
                    verbose=False,
                )

            # 결과 파싱
            boxes = results[0].boxes
            current_ids = set()

            for box in boxes:
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                cls_id = int(box.cls[0])
                confidence = float(box.conf[0])
                track_id = int(box.id[0]) if box.id is not None else -1

                if track_id < 0:
                    continue

                current_ids.add(track_id)
                cls_name = VEHICLE_CLASSES.get(cls_id, "unknown")
                centroid = ((x1 + x2) // 2, (y1 + y2) // 2)

                # 속도 계산
                if track_id in self._trails and len(self._trails[track_id]) >= 2:
                    prev = self._trails[track_id][-1]
                    dt = now - self._last_seen.get(track_id, now)
                    if dt > 0:
                        dist = ((centroid[0] - prev[0])**2 + (centroid[1] - prev[1])**2)**0.5
                        self._speeds[track_id] = dist / dt
                    else:
                        self._speeds[track_id] = 0

                # 업데이트
                if track_id not in self._trails:
                    self._trails[track_id] = deque(maxlen=self.trail_length)
                self._trails[track_id].append(centroid)
                self._classes[track_id] = cls_name
                self._confs[track_id] = confidence
                self._bboxes[track_id] = (x1, y1, x2, y2)
                self._last_seen[track_id] = now

            # 사라진 객체 정리
            for tid in list(self._bboxes.keys()):
                if tid not in current_ids:
                    if now - self._last_seen.get(tid, 0) > 3.0:
                        self._bboxes.pop(tid, None)
                        self._classes.pop(tid, None)
                        self._confs.pop(tid, None)
                        self._speeds.pop(tid, None)
                        self._crossed.pop(tid, None)
                        self._plate_reader.clear_track(tid)

            # 오래된 트레일 정리
            for tid in list(self._trails.keys()):
                if tid not in current_ids and now - self._last_seen.get(tid, 0) > 8.0:
                    del self._trails[tid]
                    self._last_seen.pop(tid, None)

            # 통계 업데이트
            self.active_count = len(current_ids)
            self.trail_count = sum(1 for t in self._trails.values() if len(t) >= 3)
            counts = {}
            for tid in current_ids:
                c = self._classes.get(tid, "unknown")
                counts[c] = counts.get(c, 0) + 1
            self._class_counts = counts

        # 번호판 인식
        self._ocr_counter += 1
        if self._ocr_counter >= self._ocr_interval and self._plate_reader.is_ready:
            self._ocr_counter = 0
            for tid in list(self._bboxes.keys()):
                if self._plate_reader.get_cached(tid) is not None:
                    continue
                self._plate_reader.read_plate(frame, self._bboxes[tid], tid)

        # 라인 교차 감지
        self._check_line_crossings(w, h)

        # 시각화
        return self._draw(frame)

    # ==================================================================
    # 라인 교차 감지
    # ==================================================================
    @staticmethod
    def _segments_intersect(p1, p2, p3, p4):
        def cross(o, a, b):
            return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
        d1, d2 = cross(p3,p4,p1), cross(p3,p4,p2)
        d3, d4 = cross(p1,p2,p3), cross(p1,p2,p4)
        if ((d1>0 and d2<0) or (d1<0 and d2>0)) and \
           ((d3>0 and d4<0) or (d3<0 and d4>0)):
            return True
        return False

    def _check_line_crossings(self, frame_w, frame_h):
        if not self._lines:
            return
        for tid, trail in self._trails.items():
            if tid not in self._bboxes:
                continue
            pts = list(trail)
            if len(pts) < 2:
                continue
            p1, p2 = pts[-2], pts[-1]
            if tid not in self._crossed:
                self._crossed[tid] = set()
            for line_cfg in self._lines:
                line_id = line_cfg.get('id', '')
                if line_id in self._crossed[tid]:
                    continue
                lx1 = int(line_cfg['x1']*frame_w)
                ly1 = int(line_cfg['y1']*frame_h)
                lx2 = int(line_cfg['x2']*frame_w)
                ly2 = int(line_cfg['y2']*frame_h)
                if self._segments_intersect(p1, p2, (lx1,ly1), (lx2,ly2)):
                    dy = p2[1] - p1[1]
                    line_type = line_cfg.get('type', 'both')
                    event_type = line_type if line_type != 'both' else ('entry' if dy > 0 else 'exit')
                    plate = self._plate_reader.get_cached(tid)
                    cls = self._classes.get(tid, 'unknown')
                    event = {
                        'type': event_type,
                        'trackId': tid,
                        'vehicleClass': cls,
                        'plateNumber': plate,
                        'lineId': line_id,
                        'lineName': line_cfg.get('name', ''),
                        'zoneId': line_cfg.get('zone_id'),
                        'cameraId': self._camera_id,
                        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
                    }
                    self._crossed[tid].add(line_id)
                    self._event_queue.append(event)
                    if len(self._event_queue) > self._max_events:
                        self._event_queue.pop(0)
                    if self._webhook_url:
                        threading.Thread(target=self._send_webhook, args=(event,), daemon=True).start()

    def _send_webhook(self, event):
        try:
            requests.post(self._webhook_url, json=event, timeout=3)
        except Exception:
            pass

    # ==================================================================
    # 시각화
    # ==================================================================
    def _draw(self, frame: np.ndarray) -> np.ndarray:
        img = frame.copy()
        h, w = img.shape[:2]
        font = cv2.FONT_HERSHEY_SIMPLEX
        now = time.time()

        # ── 구역 표시 ──
        for zone in self._zones:
            zx1, zy1 = int(zone['x1']*w), int(zone['y1']*h)
            zx2, zy2 = int(zone['x2']*w), int(zone['y2']*h)
            overlay = img.copy()
            cv2.rectangle(overlay, (zx1,zy1), (zx2,zy2), (255,200,0), -1)
            cv2.addWeighted(overlay, 0.08, img, 0.92, 0, img)
            cv2.rectangle(img, (zx1,zy1), (zx2,zy2), (255,200,0), 1, cv2.LINE_AA)
            label = zone.get('name', zone.get('label', ''))
            if label:
                cv2.putText(img, label, (zx1+4, zy1+16), font, 0.5, (255,200,0), 1, cv2.LINE_AA)

        # ── 입출차 라인 ──
        for line_cfg in self._lines:
            lx1, ly1 = int(line_cfg['x1']*w), int(line_cfg['y1']*h)
            lx2, ly2 = int(line_cfg['x2']*w), int(line_cfg['y2']*h)
            lt = line_cfg.get('type', 'both')
            lcolor = (0,200,0) if lt == 'entry' else (0,0,255) if lt == 'exit' else (255,180,0)
            cv2.line(img, (lx1,ly1), (lx2,ly2), lcolor, 2, cv2.LINE_AA)

        # ── 경로 + 바운딩박스 ──
        for tid, trail in self._trails.items():
            pts = list(trail)
            if len(pts) < 2:
                continue

            cls = self._classes.get(tid, "unknown")
            color = CLASS_COLORS.get(cls, (180,180,180))
            active = tid in self._bboxes
            n = len(pts)

            # 경로 라인 (그라데이션)
            for i in range(1, n):
                progress = i / n
                if active:
                    thickness = max(1, int(progress * 3))
                    brightness = 0.3 + 0.7 * progress
                else:
                    thickness = 1
                    brightness = 0.1 + 0.2 * progress
                c = tuple(int(v * brightness) for v in color)
                cv2.line(img, pts[i-1], pts[i], c, thickness, cv2.LINE_AA)

            if not active:
                continue

            # 현재 위치 원
            cv2.circle(img, pts[-1], 6, color, -1, cv2.LINE_AA)
            cv2.circle(img, pts[-1], 6, (255,255,255), 1, cv2.LINE_AA)

            # 이동 방향 화살표
            back = min(8, n - 1)
            dx = pts[-1][0] - pts[-1-back][0]
            dy = pts[-1][1] - pts[-1-back][1]
            dist = (dx*dx + dy*dy) ** 0.5
            if dist > 10:
                arrow_len = min(40, dist * 1.0)
                nx, ny = dx/dist, dy/dist
                tip = (int(pts[-1][0]+nx*arrow_len), int(pts[-1][1]+ny*arrow_len))
                cv2.arrowedLine(img, pts[-1], tip, color, 2, cv2.LINE_AA, tipLength=0.35)

            # ── 바운딩박스 (둥근 코너) ──
            x1, y1, x2, y2 = self._bboxes[tid]
            conf = self._confs.get(tid, 0)

            # 반투명 박스
            overlay = img.copy()
            cv2.rectangle(overlay, (x1,y1), (x2,y2), color, -1)
            cv2.addWeighted(overlay, 0.12, img, 0.88, 0, img)

            # 코너 스타일 테두리
            corner = min(15, (x2-x1)//4, (y2-y1)//4)
            t = 2
            for cx1,cy1,cx2,cy2 in [
                (x1,y1,x1+corner,y1), (x1,y1,x1,y1+corner),
                (x2,y1,x2-corner,y1), (x2,y1,x2,y1+corner),
                (x1,y2,x1+corner,y2), (x1,y2,x1,y2-corner),
                (x2,y2,x2-corner,y2), (x2,y2,x2,y2-corner),
            ]:
                cv2.line(img, (cx1,cy1), (cx2,cy2), color, t, cv2.LINE_AA)

            # ── 상단 라벨: [클래스] #ID conf% ──
            plate = self._plate_reader.get_cached(tid)
            cls_kr = CLASS_LABELS.get(cls, cls.upper())
            label_text = f"{cls_kr} #{tid}"
            conf_text = f"{conf:.0%}"

            # 라벨 배경
            (tw, th), _ = cv2.getTextSize(label_text, font, 0.5, 1)
            (cw, ch), _ = cv2.getTextSize(conf_text, font, 0.4, 1)
            total_w = tw + cw + 20
            label_h = max(th, ch) + 10
            ly = y1 - label_h - 2
            if ly < 0:
                ly = y2 + 2

            # 클래스 라벨 (컬러 배경)
            cv2.rectangle(img, (x1, ly), (x1+tw+8, ly+label_h), color, -1)
            cv2.putText(img, label_text, (x1+4, ly+label_h-4), font, 0.5, (255,255,255), 1, cv2.LINE_AA)

            # 신뢰도 (어두운 배경)
            cv2.rectangle(img, (x1+tw+8, ly), (x1+tw+cw+16, ly+label_h), (40,40,40), -1)
            cv2.putText(img, conf_text, (x1+tw+12, ly+label_h-4), font, 0.4, (200,200,200), 1, cv2.LINE_AA)

            # 번호판 (있으면) — 눈에 띄는 노란색 배경
            if plate:
                plate_font_scale = 0.6
                plate_thickness = 2
                (pw, ph), _ = cv2.getTextSize(plate, font, plate_font_scale, plate_thickness)
                px = x1
                py = y2 + 4
                pad = 6
                # 노란색 배경 + 검은 테두리
                cv2.rectangle(img, (px, py), (px+pw+pad*2, py+ph+pad*2),
                              (0, 220, 255), -1)  # 노란색 배경
                cv2.rectangle(img, (px, py), (px+pw+pad*2, py+ph+pad*2),
                              (0, 0, 0), 2)  # 검은 테두리
                # 번호판 아이콘 (작은 사각형)
                cv2.rectangle(img, (px+3, py+3), (px+pad+4, py+ph+pad-1),
                              (0, 100, 200), -1)
                cv2.putText(img, "P", (px+4, py+ph+pad-4), font, 0.3,
                            (255,255,255), 1, cv2.LINE_AA)
                # 번호판 텍스트
                cv2.putText(img, plate, (px+pad+8, py+ph+pad-2), font,
                            plate_font_scale, (0,0,0), plate_thickness, cv2.LINE_AA)

        # ── 상태 바 ──
        ts = time.strftime("%H:%M:%S")
        ocr_status = "OCR ON" if self._plate_reader.is_ready else "OCR ..."
        recognized = sum(1 for tid in self._bboxes if self._plate_reader.get_cached(tid))

        # 클래스별 카운트 문자열
        class_str = " | ".join(f"{CLASS_LABELS.get(c,c)} {n}" for c, n in sorted(self._class_counts.items()))
        if not class_str:
            class_str = "감지 없음"

        plate_str = f"번호판 {recognized}대 인식" if recognized > 0 else "번호판 대기중"
        bar = f"YOLO+ByteTrack | {ts} | {self.active_count}대 [{class_str}] | {plate_str} | {ocr_status}"

        # 상태 바 배경
        bar_h = 32
        overlay = img.copy()
        cv2.rectangle(overlay, (0, h-bar_h), (w, h), (20,20,20), -1)
        cv2.addWeighted(overlay, 0.85, img, 0.15, 0, img)

        cv2.putText(img, bar, (10, h-10), font, 0.45, (0,255,120), 1, cv2.LINE_AA)

        # ── 우상단: 감지 요약 ──
        summary_y = 20
        for cls_name, count in sorted(self._class_counts.items()):
            color_cls = CLASS_COLORS.get(cls_name, (180,180,180))
            label_kr = CLASS_LABELS.get(cls_name, cls_name)
            text = f"{label_kr}: {count}"
            (stw, sth), _ = cv2.getTextSize(text, font, 0.5, 1)
            sx = w - stw - 16
            cv2.rectangle(img, (sx-4, summary_y-sth-4), (w-4, summary_y+4), (0,0,0), -1)
            cv2.circle(img, (sx+4, summary_y-sth//2), 5, color_cls, -1, cv2.LINE_AA)
            cv2.putText(img, text, (sx+14, summary_y), font, 0.5, (255,255,255), 1, cv2.LINE_AA)
            summary_y += sth + 12

        return img
