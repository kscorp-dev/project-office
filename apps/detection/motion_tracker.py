"""
경량 모션 트래커 v3 — 고정 카메라용 차량 추적 + 입출차 감지
MOG2 배경 모델 + 센트로이드 추적 + 경로 시각화 + 라인 교차 감지

핵심 기능:
- MOG2 배경 차분 (누적 배경 대비 감지)
- 센트로이드 기반 객체 추적 + 경로 기록
- 구역/라인 설정 → 라인 교차 시 입출차 이벤트 발생
- 번호판 OCR (EasyOCR)
- 디버그 오버레이 (모션 마스크 시각화)
"""
import time
import threading
import requests
from collections import OrderedDict, deque
from typing import Dict, List, Tuple, Optional, Callable

import cv2
import numpy as np

from plate_reader import PlateReader


TRAIL_COLORS = [
    (255, 100, 80),  (80, 255, 80),  (80, 80, 255),
    (80, 255, 255),  (255, 80, 255), (255, 255, 80),
    (120, 200, 255), (255, 180, 120),(120, 255, 200),
    (200, 120, 255), (80, 200, 180), (220, 160, 80),
]


class MotionTracker:
    """
    MOG2 배경 차분 + 센트로이드 추적 + 경로 시각화.
    고정 카메라에서 움직이는 물체를 실시간 추적한다.
    """

    def __init__(
        self,
        min_area: int = 150,
        max_distance: float = 120.0,
        max_disappeared: int = 25,
        trail_length: int = 250,
        show_debug: bool = True,
    ):
        self.min_area = min_area
        self.max_distance = max_distance
        self.max_disappeared = max_disappeared
        self.trail_length = trail_length
        self.show_debug = show_debug

        # 추적 상태
        self._next_id = 0
        self._objects: OrderedDict = OrderedDict()
        self._bboxes: Dict[int, Tuple] = {}
        self._disappeared: Dict[int, int] = {}
        self._trails: Dict[int, deque] = {}
        self._last_seen: Dict[int, float] = {}

        # MOG2 배경 차분기
        self._bg_sub = cv2.createBackgroundSubtractorMOG2(
            history=500,       # 배경 학습 프레임 수
            varThreshold=25,   # 낮을수록 민감
            detectShadows=True,
        )
        self._bg_sub.setBackgroundRatio(0.7)
        self._bg_sub.setShadowThreshold(0.5)

        # 처리용 커널
        self._kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self._kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        self._kernel_dilate = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

        # 워밍업 카운터 (배경 학습)
        self._frame_count = 0
        self._warmup_frames = 60  # 이 프레임 동안 배경 학습만

        # 통계
        self.active_count = 0
        self.trail_count = 0

        # 번호판 인식기 (백그라운드 로드)
        self._plate_reader = PlateReader()
        self._ocr_interval = 10  # N프레임마다 OCR 시도
        self._ocr_counter = 0

        # 디버그용 최근 마스크
        self._debug_mask: Optional[np.ndarray] = None

        # ── 입출차 라인 설정 ──
        # lines: [{ id, name, type, x1, y1, x2, y2, zone_id }]
        # 좌표는 normalized (0-1)
        self._lines: List[Dict] = []
        self._zones: List[Dict] = []

        # 트랙별 라인 교차 기록 (중복 이벤트 방지)
        self._crossed: Dict[int, set] = {}  # track_id → set of line_ids

        # 이벤트 콜백 or 백엔드 webhook URL
        self._webhook_url: Optional[str] = None
        self._camera_id: Optional[str] = None
        self._event_queue: List[Dict] = []  # 최근 이벤트 (UI 표시용)
        self._max_events = 50

    def reset(self):
        """트래커 상태 초기화 (비디오 루프 시 호출)"""
        self._next_id = 0
        self._objects.clear()
        self._bboxes.clear()
        self._disappeared.clear()
        self._trails.clear()
        self._last_seen.clear()
        self._crossed.clear()
        self._frame_count = 0
        self.active_count = 0
        self.trail_count = 0
        self._bg_sub = cv2.createBackgroundSubtractorMOG2(
            history=500, varThreshold=25, detectShadows=True,
        )
        self._bg_sub.setBackgroundRatio(0.7)
        self._bg_sub.setShadowThreshold(0.5)

    # ==================================================================
    # 구역/라인 설정
    # ==================================================================
    def set_lines(self, lines: List[Dict]):
        """입출차 감지 라인 설정 (normalized 좌표)"""
        self._lines = lines

    def set_zones(self, zones: List[Dict]):
        """주차 구역 설정 (normalized 좌표)"""
        self._zones = zones

    def set_webhook(self, url: str, camera_id: str):
        """입출차 이벤트 전송 웹훅 URL 설정"""
        self._webhook_url = url
        self._camera_id = camera_id

    def get_recent_events(self) -> List[Dict]:
        """최근 입출차 이벤트 반환"""
        return list(self._event_queue)

    # ==================================================================
    # 라인 교차 감지 (선분 교차 알고리즘)
    # ==================================================================
    @staticmethod
    def _segments_intersect(p1: Tuple, p2: Tuple, p3: Tuple, p4: Tuple) -> bool:
        """두 선분 (p1-p2)와 (p3-p4)가 교차하는지 판정"""
        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

        d1 = cross(p3, p4, p1)
        d2 = cross(p3, p4, p2)
        d3 = cross(p1, p2, p3)
        d4 = cross(p1, p2, p4)

        if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
            return True

        if d1 == 0 and MotionTracker._on_segment(p3, p4, p1):
            return True
        if d2 == 0 and MotionTracker._on_segment(p3, p4, p2):
            return True
        if d3 == 0 and MotionTracker._on_segment(p1, p2, p3):
            return True
        if d4 == 0 and MotionTracker._on_segment(p1, p2, p4):
            return True

        return False

    @staticmethod
    def _on_segment(p, q, r):
        return (min(p[0], q[0]) <= r[0] <= max(p[0], q[0]) and
                min(p[1], q[1]) <= r[1] <= max(p[1], q[1]))

    def _check_line_crossings(self, frame_w: int, frame_h: int):
        """모든 활성 트랙에 대해 라인 교차 검사"""
        if not self._lines:
            return

        for oid, trail in self._trails.items():
            if oid not in self._objects:
                continue
            pts = list(trail)
            if len(pts) < 2:
                continue

            # 최근 이동 경로 (마지막 2점)
            p1 = pts[-2]
            p2 = pts[-1]

            if oid not in self._crossed:
                self._crossed[oid] = set()

            for line_cfg in self._lines:
                line_id = line_cfg.get('id', '')
                if line_id in self._crossed[oid]:
                    continue  # 이미 이 라인 통과함

                # normalized → pixel 좌표
                lx1 = int(line_cfg['x1'] * frame_w)
                ly1 = int(line_cfg['y1'] * frame_h)
                lx2 = int(line_cfg['x2'] * frame_w)
                ly2 = int(line_cfg['y2'] * frame_h)

                if self._segments_intersect(p1, p2, (lx1, ly1), (lx2, ly2)):
                    # 교차! 이동 방향 판별
                    dx = p2[0] - p1[0]
                    dy = p2[1] - p1[1]
                    if abs(dx) > abs(dy):
                        direction = "right" if dx > 0 else "left"
                    else:
                        direction = "down" if dy > 0 else "up"

                    line_type = line_cfg.get('type', 'both')
                    if line_type == 'both':
                        event_type = 'entry' if dy > 0 else 'exit'
                    else:
                        event_type = line_type

                    plate = self._plate_reader.get_cached(oid)

                    event = {
                        'type': event_type,
                        'trackId': oid,
                        'plateNumber': plate,
                        'lineId': line_id,
                        'lineName': line_cfg.get('name', ''),
                        'zoneId': line_cfg.get('zone_id'),
                        'direction': direction,
                        'cameraId': self._camera_id,
                        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
                    }

                    self._crossed[oid].add(line_id)
                    self._event_queue.append(event)
                    if len(self._event_queue) > self._max_events:
                        self._event_queue.pop(0)

                    # 웹훅 전송 (비동기)
                    if self._webhook_url:
                        threading.Thread(
                            target=self._send_webhook,
                            args=(event,),
                            daemon=True,
                        ).start()

                    print(f"[MotionTracker] LINE CROSS: #{oid} → {event_type} "
                          f"(plate={plate}, line={line_cfg.get('name')})")

    def _send_webhook(self, event: Dict):
        """백엔드로 입출차 이벤트 전송"""
        try:
            requests.post(
                self._webhook_url,
                json=event,
                timeout=3,
            )
        except Exception as e:
            print(f"[MotionTracker] Webhook error: {e}")

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """프레임 → 모션 감지 + 추적 + 시각화 결과 반환"""
        self._frame_count += 1
        h, w = frame.shape[:2]

        # ── 리사이즈 (처리 속도) ──
        process_w = 480
        scale = min(1.0, process_w / w)
        if scale < 1.0:
            small = cv2.resize(frame, (int(w * scale), int(h * scale)))
        else:
            small = frame.copy()
            scale = 1.0

        # ── 전처리: 약한 블러 (노이즈 제거, 디테일 유지) ──
        blurred = cv2.GaussianBlur(small, (5, 5), 0)

        # ── MOG2 배경 차분 ──
        fg_mask = self._bg_sub.apply(blurred, learningRate=-1)

        # 그림자 제거 (127 → 0)
        fg_mask[fg_mask == 127] = 0

        # ── 형태학적 처리 ──
        # 1. 작은 노이즈 제거 (open)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, self._kernel_open, iterations=1)
        # 2. 인접한 영역 연결 (close)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, self._kernel_close, iterations=2)
        # 3. 영역 확장 (dilate) — 차량 외곽 완성
        fg_mask = cv2.dilate(fg_mask, self._kernel_dilate, iterations=1)

        # 디버그 마스크 저장
        self._debug_mask = fg_mask.copy()

        # ── 워밍업 (배경 학습 중) ──
        if self._frame_count < self._warmup_frames:
            result = frame.copy()
            self._draw_warmup(result, self._frame_count, self._warmup_frames)
            return result

        # ── 윤곽선 → 바운딩박스 ──
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        inv = 1.0 / scale
        scaled_min_area = self.min_area * (scale ** 2)
        detections = []

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < scaled_min_area:
                continue

            x, y, bw, bh = cv2.boundingRect(cnt)

            # 종횡비 필터 (너무 길쭉한 것 제외)
            aspect = max(bw, bh) / (min(bw, bh) + 1)
            if aspect > 6:
                continue

            detections.append((
                int(x * inv), int(y * inv),
                int((x + bw) * inv), int((y + bh) * inv),
            ))

        # 겹치는 박스 합치기
        detections = self._merge_overlapping(detections)

        # ── 센트로이드 추적 ──
        self._update_tracking(detections)

        # ── 번호판 인식 (N프레임마다, 부하 분산) ──
        self._ocr_counter += 1
        if self._ocr_counter >= self._ocr_interval and self._plate_reader.is_ready:
            self._ocr_counter = 0
            for oid in list(self._objects.keys()):
                if self._plate_reader.get_cached(oid) is not None:
                    continue  # 이미 인식됨
                if oid in self._bboxes:
                    self._plate_reader.read_plate(frame, self._bboxes[oid], oid)

        # ── 입출차 라인 교차 감지 ──
        self._check_line_crossings(w, h)

        # ── 시각화 ──
        result = self._draw(frame)
        return result

    # ==================================================================
    # 박스 합치기
    # ==================================================================
    def _merge_overlapping(self, boxes: List[Tuple], thresh: float = 0.3) -> List[Tuple]:
        if len(boxes) <= 1:
            return boxes

        arr = np.array(boxes, dtype=np.float32)
        x1, y1, x2, y2 = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        order = areas.argsort()[::-1]

        merged = []
        used = set()

        for i in order:
            if i in used:
                continue
            mx1, my1, mx2, my2 = x1[i], y1[i], x2[i], y2[i]

            for j in order:
                if j in used or j == i:
                    continue
                ix1 = max(mx1, x1[j])
                iy1 = max(my1, y1[j])
                ix2 = min(mx2, x2[j])
                iy2 = min(my2, y2[j])
                inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
                smaller = min(areas[i], areas[j])
                if smaller > 0 and inter / smaller > thresh:
                    mx1 = min(mx1, x1[j])
                    my1 = min(my1, y1[j])
                    mx2 = max(mx2, x2[j])
                    my2 = max(my2, y2[j])
                    used.add(j)

            merged.append((int(mx1), int(my1), int(mx2), int(my2)))
            used.add(i)

        return merged

    # ==================================================================
    # 센트로이드 추적
    # ==================================================================
    def _update_tracking(self, detections: List[Tuple]):
        now = time.time()

        if len(detections) == 0:
            for oid in list(self._disappeared.keys()):
                self._disappeared[oid] += 1
                if self._disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)
            self._update_stats()
            return

        new_centroids = []
        for x1, y1, x2, y2 in detections:
            new_centroids.append(((x1 + x2) // 2, (y1 + y2) // 2))

        if len(self._objects) == 0:
            for i, c in enumerate(new_centroids):
                self._register(c, detections[i], now)
            self._update_stats()
            return

        obj_ids = list(self._objects.keys())
        obj_cents = [self._objects[oid] for oid in obj_ids]

        # 거리 행렬
        dists = np.zeros((len(obj_cents), len(new_centroids)))
        for i, oc in enumerate(obj_cents):
            for j, nc in enumerate(new_centroids):
                dists[i, j] = ((oc[0] - nc[0]) ** 2 + (oc[1] - nc[1]) ** 2) ** 0.5

        rows = dists.min(axis=1).argsort()
        cols = dists.argmin(axis=1)[rows]

        used_rows, used_cols = set(), set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
            if dists[row, col] > self.max_distance:
                continue

            oid = obj_ids[row]
            self._objects[oid] = new_centroids[col]
            self._bboxes[oid] = detections[col]
            self._disappeared[oid] = 0
            self._trails[oid].append(new_centroids[col])
            self._last_seen[oid] = now
            used_rows.add(row)
            used_cols.add(col)

        for row in set(range(len(obj_ids))) - used_rows:
            oid = obj_ids[row]
            self._disappeared[oid] += 1
            if self._disappeared[oid] > self.max_disappeared:
                self._deregister(oid)

        for col in set(range(len(new_centroids))) - used_cols:
            self._register(new_centroids[col], detections[col], now)

        self._update_stats()

    def _register(self, centroid: Tuple, bbox: Tuple, now: float):
        oid = self._next_id
        self._objects[oid] = centroid
        self._bboxes[oid] = bbox
        self._disappeared[oid] = 0
        self._trails[oid] = deque(maxlen=self.trail_length)
        self._trails[oid].append(centroid)
        self._last_seen[oid] = now
        self._next_id += 1

    def _deregister(self, oid: int):
        del self._objects[oid]
        del self._bboxes[oid]
        del self._disappeared[oid]
        self._plate_reader.clear_track(oid)
        self._crossed.pop(oid, None)

    def _update_stats(self):
        self.active_count = len(self._objects)
        self.trail_count = sum(1 for t in self._trails.values() if len(t) >= 3)

        now = time.time()
        dead = [
            oid for oid in list(self._trails.keys())
            if oid not in self._objects and now - self._last_seen.get(oid, 0) > 10
        ]
        for oid in dead:
            del self._trails[oid]
            self._last_seen.pop(oid, None)

    # ==================================================================
    # 시각화
    # ==================================================================
    def _draw(self, frame: np.ndarray) -> np.ndarray:
        img = frame.copy()
        h, w = img.shape[:2]

        # ── 구역 표시 ──
        for zone in self._zones:
            zx1 = int(zone['x1'] * w)
            zy1 = int(zone['y1'] * h)
            zx2 = int(zone['x2'] * w)
            zy2 = int(zone['y2'] * h)
            overlay = img.copy()
            cv2.rectangle(overlay, (zx1, zy1), (zx2, zy2), (255, 200, 0), -1)
            cv2.addWeighted(overlay, 0.08, img, 0.92, 0, img)
            cv2.rectangle(img, (zx1, zy1), (zx2, zy2), (255, 200, 0), 1, cv2.LINE_AA)
            label = zone.get('name', zone.get('label', ''))
            if label:
                cv2.putText(img, label, (zx1 + 4, zy1 + 16),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 200, 0), 1, cv2.LINE_AA)

        # ── 입출차 라인 표시 ──
        for line_cfg in self._lines:
            lx1 = int(line_cfg['x1'] * w)
            ly1 = int(line_cfg['y1'] * h)
            lx2 = int(line_cfg['x2'] * w)
            ly2 = int(line_cfg['y2'] * h)
            lt = line_cfg.get('type', 'both')
            if lt == 'entry':
                lcolor = (0, 200, 0)
            elif lt == 'exit':
                lcolor = (0, 0, 255)
            else:
                lcolor = (255, 180, 0)
            cv2.line(img, (lx1, ly1), (lx2, ly2), lcolor, 2, cv2.LINE_AA)
            # 라인 라벨
            mid_x = (lx1 + lx2) // 2
            mid_y = (ly1 + ly2) // 2
            lbl = line_cfg.get('name', lt.upper())
            cv2.putText(img, lbl, (mid_x - 20, mid_y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, lcolor, 1, cv2.LINE_AA)

        # ── 경로 라인 (모든 트레일) ──
        for oid, trail in self._trails.items():
            pts = list(trail)
            if len(pts) < 3:
                continue

            active = oid in self._objects
            color = TRAIL_COLORS[oid % len(TRAIL_COLORS)]
            n = len(pts)

            # 그라데이션 경로 라인
            for i in range(1, n):
                progress = i / n
                if active:
                    thickness = max(2, int(progress * 5))
                    brightness = 0.2 + 0.8 * progress
                else:
                    thickness = max(1, int(progress * 2))
                    brightness = 0.05 + 0.15 * progress

                c = tuple(int(v * brightness) for v in color)
                cv2.line(img, pts[i - 1], pts[i], c, thickness, cv2.LINE_AA)

            if active:
                # 현재 위치 — 밝은 원 + 흰 테두리
                cv2.circle(img, pts[-1], 8, color, -1, cv2.LINE_AA)
                cv2.circle(img, pts[-1], 8, (255, 255, 255), 2, cv2.LINE_AA)

                # 시작점 작은 원
                cv2.circle(img, pts[0], 4, color, -1, cv2.LINE_AA)

                # 이동 방향 화살표
                back = min(10, n - 1)
                dx = pts[-1][0] - pts[-1 - back][0]
                dy = pts[-1][1] - pts[-1 - back][1]
                dist = (dx * dx + dy * dy) ** 0.5
                if dist > 12:
                    arrow_len = min(55, dist * 1.2)
                    nx, ny = dx / dist, dy / dist
                    tip = (int(pts[-1][0] + nx * arrow_len),
                           int(pts[-1][1] + ny * arrow_len))
                    cv2.arrowedLine(img, pts[-1], tip, color, 2, cv2.LINE_AA, tipLength=0.3)

        # ── 바운딩박스 + ID + 번호판 ──
        for oid in self._objects:
            if oid not in self._bboxes:
                continue
            x1, y1, x2, y2 = self._bboxes[oid]
            color = TRAIL_COLORS[oid % len(TRAIL_COLORS)]

            # 코너 스타일 바운딩박스
            corner = min(18, (x2 - x1) // 4, (y2 - y1) // 4)
            t = 2
            cv2.line(img, (x1, y1), (x1 + corner, y1), color, t, cv2.LINE_AA)
            cv2.line(img, (x1, y1), (x1, y1 + corner), color, t, cv2.LINE_AA)
            cv2.line(img, (x2, y1), (x2 - corner, y1), color, t, cv2.LINE_AA)
            cv2.line(img, (x2, y1), (x2, y1 + corner), color, t, cv2.LINE_AA)
            cv2.line(img, (x1, y2), (x1 + corner, y2), color, t, cv2.LINE_AA)
            cv2.line(img, (x1, y2), (x1, y2 - corner), color, t, cv2.LINE_AA)
            cv2.line(img, (x2, y2), (x2 - corner, y2), color, t, cv2.LINE_AA)
            cv2.line(img, (x2, y2), (x2, y2 - corner), color, t, cv2.LINE_AA)

            # 번호판 인식 결과
            plate = self._plate_reader.get_cached(oid)

            # ── 라벨 구성: 트래킹 번호 + 번호판 ──
            label_id = f"#{oid}"
            label_plate = plate or ""

            # 트래킹 번호 (상단 좌측, 큰 글씨)
            font = cv2.FONT_HERSHEY_SIMPLEX
            (tw1, th1), _ = cv2.getTextSize(label_id, font, 0.65, 2)
            label_y = y1 - 8
            cv2.rectangle(img, (x1, label_y - th1 - 8), (x1 + tw1 + 10, label_y + 2), color, -1)
            cv2.putText(img, label_id, (x1 + 5, label_y - 2),
                        font, 0.65, (255, 255, 255), 2, cv2.LINE_AA)

            # 번호판 4자리 (트래킹 번호 옆, 밝은 배경)
            if label_plate:
                plate_x = x1 + tw1 + 14
                (tw2, th2), _ = cv2.getTextSize(label_plate, font, 0.7, 2)
                cv2.rectangle(img,
                              (plate_x - 2, label_y - th2 - 8),
                              (plate_x + tw2 + 10, label_y + 2),
                              (255, 255, 255), -1)
                cv2.rectangle(img,
                              (plate_x - 2, label_y - th2 - 8),
                              (plate_x + tw2 + 10, label_y + 2),
                              color, 2)
                cv2.putText(img, label_plate, (plate_x + 4, label_y - 2),
                            font, 0.7, (0, 0, 0), 2, cv2.LINE_AA)

        # ── 디버그 오버레이: 모션 마스크 (우하단 PIP) ──
        if self.show_debug and self._debug_mask is not None:
            pip_h = h // 5
            pip_w = int(pip_h * self._debug_mask.shape[1] / self._debug_mask.shape[0])
            pip = cv2.resize(self._debug_mask, (pip_w, pip_h))
            pip_color = cv2.cvtColor(pip, cv2.COLOR_GRAY2BGR)
            # 녹색 틴트
            pip_color[:, :, 1] = cv2.add(pip_color[:, :, 1], pip // 3)

            # 테두리
            cv2.rectangle(pip_color, (0, 0), (pip_w - 1, pip_h - 1), (0, 255, 0), 1)
            cv2.putText(pip_color, "MOTION", (4, 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

            # 우하단에 합성
            y_off = h - 34 - pip_h - 4
            x_off = w - pip_w - 4
            img[y_off:y_off + pip_h, x_off:x_off + pip_w] = pip_color

        # ── 상태 바 ──
        ts = time.strftime("%H:%M:%S")
        ocr_status = "OCR ON" if self._plate_reader.is_ready else "OCR loading..."
        recognized = sum(1 for oid in self._objects if self._plate_reader.get_cached(oid))
        bar = (f"TRACKING | {ts} | {self.active_count} objects | "
               f"{self.trail_count} trails | {recognized} plates | {ocr_status}")
        cv2.rectangle(img, (0, h - 34), (w, h), (0, 0, 0), -1)
        cv2.putText(img, bar, (10, h - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 120), 1, cv2.LINE_AA)

        return img

    def _draw_warmup(self, img: np.ndarray, current: int, total: int):
        """배경 학습 중 표시"""
        h, w = img.shape[:2]
        progress = current / total
        bar_w = int(w * 0.4)
        bar_x = (w - bar_w) // 2
        bar_y = h // 2

        cv2.rectangle(img, (bar_x, bar_y - 1), (bar_x + bar_w, bar_y + 20), (40, 40, 40), -1)
        cv2.rectangle(img, (bar_x, bar_y), (bar_x + int(bar_w * progress), bar_y + 18),
                      (0, 200, 100), -1)

        text = f"Background Learning... {int(progress * 100)}%"
        (tw, _), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.putText(img, text, ((w - tw) // 2, bar_y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

        cv2.rectangle(img, (0, h - 34), (w, h), (0, 0, 0), -1)
        cv2.putText(img, f"Initializing... ({current}/{total})", (10, h - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 255), 1, cv2.LINE_AA)
