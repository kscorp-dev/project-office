"""
주차장 YOLO 감지 API 서버
FastAPI 기반, YOLOv8 Nano 모델 사용
"""
import io
import time
import base64
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from config import HOST, PORT, UPLOAD_DIR, RESULT_DIR
from detector import ParkingDetector


# --- 전역 감지기 ---
detector: ParkingDetector = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작 시 모델 로드"""
    global detector
    print("[Detection API] Loading YOLOv8n model...")
    detector = ParkingDetector()
    print("[Detection API] Ready!")
    yield
    print("[Detection API] Shutting down.")


app = FastAPI(
    title="Project Office — Parking Detection API",
    description="YOLOv8 Nano 기반 주차장 차량 감지 + 구역 매핑 서비스",
    version="0.4.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# Health Check
# ------------------------------------------------------------------
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "yolov8n",
        "model_loaded": detector is not None and detector.model is not None,
    }


# ------------------------------------------------------------------
# 메인 감지 API — 이미지 업로드
# ------------------------------------------------------------------
@app.post("/api/detect")
async def detect_vehicles(
    image: UploadFile = File(...),
    confidence: float = Query(0.35, ge=0.1, le=1.0),
    save_result: bool = Query(False),
):
    """
    주차장 이미지를 업로드하면 차량 위치 + 구역 매핑 결과 반환

    - **image**: 주차장 사진 (JPEG/PNG)
    - **confidence**: 감지 신뢰도 임계값 (기본 0.35)
    - **save_result**: 결과 이미지 저장 여부
    """
    if not image.content_type.startswith("image/"):
        raise HTTPException(400, "이미지 파일만 업로드 가능합니다.")

    contents = await image.read()
    result = detector.detect_from_bytes(
        contents,
        conf=confidence,
        save_result=save_result,
    )

    if not result["success"]:
        raise HTTPException(500, result.get("error", "Detection failed"))

    return result


# ------------------------------------------------------------------
# 감지 + 결과 이미지 반환 (base64)
# ------------------------------------------------------------------
@app.post("/api/detect/visual")
async def detect_with_visual(
    image: UploadFile = File(...),
    confidence: float = Query(0.35, ge=0.1, le=1.0),
):
    """
    감지 결과 + 바운딩박스가 그려진 이미지(base64)를 함께 반환
    """
    if not image.content_type.startswith("image/"):
        raise HTTPException(400, "이미지 파일만 업로드 가능합니다.")

    contents = await image.read()
    result_name = f"visual_{int(time.time())}.jpg"
    result = detector.detect_from_bytes(
        contents,
        conf=confidence,
        save_result=True,
        result_name=result_name,
    )

    if not result["success"]:
        raise HTTPException(500, result.get("error", "Detection failed"))

    # 결과 이미지를 base64로 인코딩
    result_path = Path(result.get("result_image", ""))
    if result_path.exists():
        with open(result_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("utf-8")
        result["result_image_base64"] = f"data:image/jpeg;base64,{img_b64}"
        # 임시 파일 삭제
        result_path.unlink(missing_ok=True)
    del result["result_image"]

    return result


# ------------------------------------------------------------------
# 구역 설정 조회/수정
# ------------------------------------------------------------------
@app.get("/api/zones")
async def get_zones():
    """현재 주차 구역 설정 및 주차면 그리드 반환"""
    return detector.get_zone_status()


class ZoneUpdate(BaseModel):
    zone_id: str
    x1: float | None = None
    y1: float | None = None
    x2: float | None = None
    y2: float | None = None
    rows: int | None = None
    cols: int | None = None
    total_spots: int | None = None
    name: str | None = None


@app.put("/api/zones")
async def update_zone(update: ZoneUpdate):
    """구역 좌표/크기 수정 (관리자용)"""
    updates = {k: v for k, v in update.model_dump().items()
               if v is not None and k != "zone_id"}
    if not updates:
        raise HTTPException(400, "수정할 값이 없습니다.")

    ok = detector.mapper.update_zone(update.zone_id, **updates)
    if not ok:
        raise HTTPException(404, f"구역 {update.zone_id}을 찾을 수 없습니다.")

    detector.mapper.save_config()
    return {"success": True, "zone_id": update.zone_id, "updated": updates}


# ------------------------------------------------------------------
# 결과 이미지 조회
# ------------------------------------------------------------------
@app.get("/api/results/{filename}")
async def get_result_image(filename: str):
    """저장된 감지 결과 이미지 조회"""
    path = RESULT_DIR / filename
    if not path.exists():
        raise HTTPException(404, "결과 이미지를 찾을 수 없습니다.")
    return FileResponse(path, media_type="image/jpeg")


# ------------------------------------------------------------------
# 실행
# ------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    uvicorn.run("app:app", host=HOST, port=PORT, reload=True)
