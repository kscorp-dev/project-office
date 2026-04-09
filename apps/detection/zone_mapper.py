"""
주차 구역 매핑 — 감지된 차량 위치를 A/B/C 구역 + 주차면에 매핑
"""
import json
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

from config import ZONE_CONFIG_DIR


@dataclass
class ParkingSpot:
    zone: str          # "A", "B", "C"
    spot_number: int   # 1~20
    label: str         # "A-01"
    x1: float          # 주차면 좌상단 x (정규화 0~1)
    y1: float          # 주차면 좌상단 y
    x2: float          # 주차면 우하단 x
    y2: float          # 주차면 우하단 y
    occupied: bool = False
    vehicle_plate: Optional[str] = None
    confidence: float = 0.0


@dataclass
class ZoneConfig:
    zone_id: str       # "A", "B", "C"
    name: str          # "A구역 (본관 앞)"
    x1: float
    y1: float
    x2: float
    y2: float
    rows: int
    cols: int
    total_spots: int
    color: str         # hex color


# 기본 구역 설정 — 1280x720 기준 정규화 좌표
DEFAULT_ZONES: list[ZoneConfig] = [
    ZoneConfig(
        zone_id="A", name="A구역 (본관 앞)",
        x1=0.02, y1=0.05, x2=0.35, y2=0.95,
        rows=5, cols=4, total_spots=20,
        color="#3b82f6"
    ),
    ZoneConfig(
        zone_id="B", name="B구역 (물류동)",
        x1=0.37, y1=0.05, x2=0.65, y2=0.95,
        rows=5, cols=3, total_spots=15,
        color="#22c55e"
    ),
    ZoneConfig(
        zone_id="C", name="C구역 (방문자)",
        x1=0.67, y1=0.05, x2=0.98, y2=0.70,
        rows=5, cols=2, total_spots=10,
        color="#eab308"
    ),
]


def _generate_spots(zone: ZoneConfig) -> list[ParkingSpot]:
    """구역 내 주차면 그리드 생성"""
    spots = []
    zone_w = zone.x2 - zone.x1
    zone_h = zone.y2 - zone.y1
    spot_w = zone_w / zone.cols
    spot_h = zone_h / zone.rows

    num = 0
    for r in range(zone.rows):
        for c in range(zone.cols):
            num += 1
            if num > zone.total_spots:
                break
            sx1 = zone.x1 + c * spot_w
            sy1 = zone.y1 + r * spot_h
            sx2 = sx1 + spot_w
            sy2 = sy1 + spot_h
            spots.append(ParkingSpot(
                zone=zone.zone_id,
                spot_number=num,
                label=f"{zone.zone_id}-{num:02d}",
                x1=round(sx1, 4),
                y1=round(sy1, 4),
                x2=round(sx2, 4),
                y2=round(sy2, 4),
            ))
    return spots


class ZoneMapper:
    """차량 바운딩박스 중심점으로 구역/주차면 판별"""

    def __init__(self, config_path: Optional[str] = None):
        self.zones = DEFAULT_ZONES
        self.spots: list[ParkingSpot] = []

        if config_path and Path(config_path).exists():
            self._load_config(config_path)

        self._build_spots()

    def _load_config(self, path: str):
        """JSON 설정 파일에서 구역 로드"""
        with open(path) as f:
            data = json.load(f)
        self.zones = [ZoneConfig(**z) for z in data["zones"]]

    def _build_spots(self):
        """모든 구역의 주차면 생성"""
        self.spots = []
        for zone in self.zones:
            self.spots.extend(_generate_spots(zone))

    def find_zone(self, cx: float, cy: float) -> Optional[str]:
        """중심 좌표가 어느 구역에 속하는지 반환"""
        for zone in self.zones:
            if zone.x1 <= cx <= zone.x2 and zone.y1 <= cy <= zone.y2:
                return zone.zone_id
        return None

    def find_spot(self, cx: float, cy: float) -> Optional[ParkingSpot]:
        """중심 좌표가 어느 주차면에 속하는지 반환"""
        for spot in self.spots:
            if spot.x1 <= cx <= spot.x2 and spot.y1 <= cy <= spot.y2:
                return spot
        return None

    def map_detections(self, detections: list[dict]) -> dict:
        """
        YOLO 감지 결과를 구역/주차면에 매핑

        Args:
            detections: [{"cx": 0.15, "cy": 0.3, "w": 0.08, "h": 0.12, "conf": 0.87, "class": "car"}, ...]
                        좌표는 이미지 크기 대비 정규화(0~1)

        Returns:
            {
                "total_detected": 5,
                "zone_summary": {"A": {"occupied": 3, "total": 20}, ...},
                "vehicles": [{"zone": "A", "spot": "A-03", "conf": 0.87, ...}, ...],
                "spots": [전체 주차면 상태]
            }
        """
        # 주차면 초기화
        for spot in self.spots:
            spot.occupied = False
            spot.vehicle_plate = None
            spot.confidence = 0.0

        vehicles = []
        for det in detections:
            cx, cy = det["cx"], det["cy"]
            zone_id = self.find_zone(cx, cy)
            spot = self.find_spot(cx, cy)

            vehicle_info = {
                "cx": cx,
                "cy": cy,
                "width": det.get("w", 0),
                "height": det.get("h", 0),
                "confidence": det["conf"],
                "class": det.get("class", "car"),
                "zone": zone_id,
                "spot_label": spot.label if spot else None,
                "spot_number": spot.spot_number if spot else None,
            }
            vehicles.append(vehicle_info)

            if spot:
                spot.occupied = True
                spot.confidence = det["conf"]

        # 구역별 요약
        zone_summary = {}
        for zone in self.zones:
            zone_spots = [s for s in self.spots if s.zone == zone.zone_id]
            occupied = sum(1 for s in zone_spots if s.occupied)
            zone_summary[zone.zone_id] = {
                "name": zone.name,
                "occupied": occupied,
                "total": zone.total_spots,
                "available": zone.total_spots - occupied,
                "occupancy_rate": round(occupied / zone.total_spots * 100, 1) if zone.total_spots > 0 else 0,
                "color": zone.color,
            }

        return {
            "total_detected": len(vehicles),
            "zone_summary": zone_summary,
            "vehicles": vehicles,
            "spots": [asdict(s) for s in self.spots],
        }

    def get_zone_configs(self) -> list[dict]:
        """현재 구역 설정 반환"""
        return [asdict(z) for z in self.zones]

    def save_config(self, path: Optional[str] = None):
        """구역 설정을 JSON으로 저장"""
        save_path = Path(path) if path else ZONE_CONFIG_DIR / "default.json"
        save_path.parent.mkdir(parents=True, exist_ok=True)
        data = {"zones": [asdict(z) for z in self.zones]}
        with open(save_path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def update_zone(self, zone_id: str, **kwargs):
        """특정 구역 설정 업데이트"""
        for zone in self.zones:
            if zone.zone_id == zone_id:
                for key, val in kwargs.items():
                    if hasattr(zone, key):
                        setattr(zone, key, val)
                self._build_spots()
                return True
        return False
