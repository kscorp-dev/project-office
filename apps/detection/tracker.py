"""
센트로이드 기반 객체 추적기
YOLO 없이 OpenCV 모션 감지 결과를 프레임 간 추적
"""
from collections import OrderedDict, deque
from typing import Dict, List, Tuple

import numpy as np
from scipy.spatial import distance as dist


class CentroidTracker:
    """
    프레임 간 객체를 센트로이드(중심점) 거리로 매칭하여 추적.
    각 객체에 고유 ID를 부여하고 이동 경로를 기록한다.
    """

    def __init__(
        self,
        max_disappeared: int = 15,
        max_distance: float = 80.0,
        max_trail: int = 200,
    ):
        """
        Args:
            max_disappeared: 미감지 허용 프레임 수 (이후 삭제)
            max_distance: 같은 객체로 판정할 최대 거리 (px)
            max_trail: 경로 기록 최대 포인트 수
        """
        self._next_id = 0
        self.objects: OrderedDict = OrderedDict()        # {id: centroid}
        self.bboxes: Dict[int, Tuple] = {}                # {id: (x1,y1,x2,y2)}
        self.disappeared: OrderedDict = OrderedDict()     # {id: 미감지 카운트}
        self.trails: Dict[int, deque] = {}                # {id: deque([(cx,cy), ...])}

        self.max_disappeared = max_disappeared
        self.max_distance = max_distance
        self.max_trail = max_trail

    def _register(self, centroid: np.ndarray, bbox: Tuple):
        oid = self._next_id
        self.objects[oid] = centroid
        self.bboxes[oid] = bbox
        self.disappeared[oid] = 0
        self.trails[oid] = deque(maxlen=self.max_trail)
        self.trails[oid].append(tuple(centroid.astype(int)))
        self._next_id += 1

    def _deregister(self, oid: int):
        del self.objects[oid]
        del self.bboxes[oid]
        del self.disappeared[oid]
        # trails은 페이드아웃을 위해 잠시 유지
        # (외부에서 get_fading_trails로 접근 후 정리)

    def update(self, detections: List[Tuple]) -> Dict[int, dict]:
        """
        새 프레임의 감지 결과로 추적 상태 업데이트.

        Args:
            detections: [(x1, y1, x2, y2), ...] 바운딩박스 목록

        Returns:
            {id: {"centroid": (cx,cy), "bbox": (x1,y1,x2,y2)}}
        """
        if len(detections) == 0:
            for oid in list(self.disappeared.keys()):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)
            return self._build_result()

        # 새 감지의 센트로이드 계산
        input_centroids = np.zeros((len(detections), 2), dtype="float")
        input_bboxes = []
        for i, (x1, y1, x2, y2) in enumerate(detections):
            input_centroids[i] = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
            input_bboxes.append((x1, y1, x2, y2))

        # 기존 추적 객체가 없으면 모두 등록
        if len(self.objects) == 0:
            for i in range(len(input_centroids)):
                self._register(input_centroids[i], input_bboxes[i])
            return self._build_result()

        # 기존 객체와 새 감지 간 거리 행렬 계산
        object_ids = list(self.objects.keys())
        object_centroids = list(self.objects.values())

        D = dist.cdist(np.array(object_centroids), input_centroids)

        # 행(기존)을 최소 거리순으로 정렬
        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows = set()
        used_cols = set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
            if D[row, col] > self.max_distance:
                continue

            oid = object_ids[row]
            self.objects[oid] = input_centroids[col]
            self.bboxes[oid] = input_bboxes[col]
            self.disappeared[oid] = 0
            self.trails[oid].append(tuple(input_centroids[col].astype(int)))

            used_rows.add(row)
            used_cols.add(col)

        # 매칭되지 않은 기존 객체 → disappeared 증가
        unused_rows = set(range(D.shape[0])) - used_rows
        for row in unused_rows:
            oid = object_ids[row]
            self.disappeared[oid] += 1
            if self.disappeared[oid] > self.max_disappeared:
                self._deregister(oid)

        # 매칭되지 않은 새 감지 → 신규 등록
        unused_cols = set(range(D.shape[1])) - used_cols
        for col in unused_cols:
            self._register(input_centroids[col], input_bboxes[col])

        return self._build_result()

    def _build_result(self) -> Dict[int, dict]:
        return {
            oid: {
                "centroid": tuple(c.astype(int)),
                "bbox": self.bboxes[oid],
            }
            for oid, c in self.objects.items()
        }

    def get_all_trails(self) -> Dict[int, list]:
        """모든 트랙의 경로 반환 (활성 + 페이딩)"""
        result = {}
        for oid, trail in self.trails.items():
            if len(trail) >= 2:
                active = oid in self.objects
                result[oid] = {
                    "points": list(trail),
                    "active": active,
                }
        return result

    def cleanup_dead_trails(self):
        """비활성 트랙 중 포인트가 소진된 것 정리"""
        dead = [
            oid for oid in self.trails
            if oid not in self.objects and len(self.trails[oid]) == 0
        ]
        for oid in dead:
            del self.trails[oid]

    def fade_dead_trails(self):
        """비활성 트랙의 포인트를 하나씩 제거 (페이드아웃)"""
        dead_ids = [oid for oid in self.trails if oid not in self.objects]
        for oid in dead_ids:
            if len(self.trails[oid]) > 0:
                self.trails[oid].popleft()
        self.cleanup_dead_trails()
