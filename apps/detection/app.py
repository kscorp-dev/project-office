"""
주차장 YOLO 감지 API 서버
FastAPI 기반, YOLOv8 Nano 모델 사용
실시간 카메라 스트리밍 + WebSocket 지원
"""
import io
import os
import re
import time
import asyncio
import base64
from pathlib import Path
from contextlib import asynccontextmanager

from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from config import HOST, PORT, UPLOAD_DIR, RESULT_DIR
from detector import ParkingDetector
from camera_stream import CameraManager, StreamlinkStream

# 백엔드 webhook URL (입출차 이벤트 전송용)
# 환경변수 BACKEND_WEBHOOK_URL 우선, 없으면 개발용 localhost
BACKEND_WEBHOOK_URL = os.getenv(
    "BACKEND_WEBHOOK_URL",
    "http://localhost:3000/api/parking/events/webhook",
)


# --- 전역 ---
detector: ParkingDetector = None
cam_manager: CameraManager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작 시 모델 로드 + 카메라 매니저 초기화"""
    global detector, cam_manager
    print("[Detection API] Loading YOLO model...")
    detector = ParkingDetector()
    cam_manager = CameraManager(
        yolo_model=detector.model,
        yolo_device=detector.device,
    )
    print("[Detection API] Ready!")
    yield
    print("[Detection API] Shutting down cameras...")
    cam_manager.disconnect_all()
    print("[Detection API] Done.")


app = FastAPI(
    title="Project Office — Parking Detection API",
    description="YOLOv8 Nano 기반 주차장 차량 감지 + 구역 매핑 서비스",
    version="0.6.0",
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
        "model": detector.model.model_name if detector and detector.model else "unknown",
        "device": detector.device if detector else "unknown",
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
    x1: Optional[float] = None
    y1: Optional[float] = None
    x2: Optional[float] = None
    y2: Optional[float] = None
    rows: Optional[int] = None
    cols: Optional[int] = None
    total_spots: Optional[int] = None
    name: Optional[str] = None


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


# ==================================================================
# 실시간 카메라 스트리밍 API
# ==================================================================

class CameraConnect(BaseModel):
    ip: str
    port: int
    name: str = ""
    path: str = ""
    protocol: str = "rtsp"        # rtsp | http
    username: str = ""
    password: str = ""
    target_fps: int = 20          # 목표 프레임레이트
    min_area: int = 800           # 최소 감지 면적 (px²)


@app.post("/api/cameras")
async def add_and_connect_camera(req: CameraConnect):
    """
    카메라 추가 + 모션 트래킹 연결

    - **ip**: 카메라 IP 주소
    - **port**: 포트 번호 (RTSP 기본 554, HTTP 기본 80)
    - **protocol**: rtsp 또는 http
    - **path**: 스트림 경로
    - **target_fps**: 목표 프레임레이트 (기본 20)
    - **min_area**: 최소 감지 면적 px² (기본 800)
    """
    stream = cam_manager.add_camera(
        ip=req.ip, port=req.port, name=req.name,
        path=req.path, protocol=req.protocol,
        username=req.username, password=req.password,
    )
    ok = stream.connect(
        target_fps=req.target_fps,
        min_area=req.min_area,
    )
    return {
        "success": ok,
        "camera_id": stream.info.camera_id,
        "status": stream.info.status.value,
        "url": stream.info.url,
        "error": stream.info.last_error or None,
    }


@app.get("/api/cameras")
async def list_cameras():
    """연결된 카메라 목록"""
    return {"cameras": cam_manager.get_all_status()}


@app.get("/api/cameras/{camera_id}")
async def get_camera_status(camera_id: str):
    """특정 카메라 상태 조회"""
    stream = cam_manager.cameras.get(camera_id)
    if not stream:
        raise HTTPException(404, "카메라를 찾을 수 없습니다.")
    return stream.get_status()


@app.get("/api/cameras/{camera_id}/stream")
async def mjpeg_stream(camera_id: str):
    """MJPEG 실시간 스트림 (브라우저 <img> 태그에서 직접 사용)"""
    stream = cam_manager.cameras.get(camera_id)
    if not stream:
        raise HTTPException(404, "카메라를 찾을 수 없습니다.")
    return StreamingResponse(
        stream.generate_mjpeg(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.delete("/api/cameras/{camera_id}")
async def disconnect_camera(camera_id: str):
    """카메라 연결 해제 및 삭제"""
    cam_manager.remove_camera(camera_id)
    return {"success": True, "camera_id": camera_id}


class DemoSource(BaseModel):
    source: str              # 비디오 파일 경로 또는 URL
    name: str = "테스트 영상"
    min_area: int = 600


@app.post("/api/cameras/demo")
async def add_demo_source(req: DemoSource):
    """
    비디오 파일/URL을 카메라 소스로 추가 (테스트용, 루프 재생)

    - **source**: 로컬 파일 경로 또는 동영상 URL
    - **name**: 표시 이름
    - **min_area**: 최소 감지 면적 px²
    """
    stream = cam_manager.add_file_source(source=req.source, name=req.name)
    ok = stream.connect(min_area=req.min_area)
    return {
        "success": ok,
        "camera_id": stream.info.camera_id,
        "status": stream.info.status.value,
        "url": stream.info.url,
        "error": stream.info.last_error or None,
    }


@app.post("/api/cameras/demo/upload")
async def upload_demo_video(
    video: UploadFile = File(...),
    name: str = Query("업로드 영상"),
    min_area: int = Query(600),
):
    """비디오 파일 업로드 → 카메라 소스로 추가"""
    if not video.content_type or not video.content_type.startswith("video/"):
        raise HTTPException(400, "비디오 파일만 업로드 가능합니다.")

    save_path = UPLOAD_DIR / f"demo_{int(time.time())}_{video.filename}"
    contents = await video.read()
    with open(save_path, "wb") as f:
        f.write(contents)

    stream = cam_manager.add_file_source(source=str(save_path), name=name)
    ok = stream.connect(min_area=min_area)
    return {
        "success": ok,
        "camera_id": stream.info.camera_id,
        "status": stream.info.status.value,
        "file": str(save_path),
        "error": stream.info.last_error or None,
    }


def _is_youtube_url(url: str) -> bool:
    return bool(re.match(
        r'https?://(www\.)?(youtube\.com|youtu\.be)/', url
    ))


def _check_youtube_live(url: str) -> tuple:
    """streamlink으로 YouTube 라이브 여부 확인 + 제목 가져오기"""
    import streamlink as sl
    streams = sl.streams(url)
    if not streams:
        return False, "", False
    # streamlink이 스트림을 찾으면 라이브 가능성 높음
    # 제목은 yt-dlp로 가져옴 (다운로드 없이)
    title = ""
    is_live = False
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get('title', '')
            is_live = info.get('is_live', False)
    except Exception:
        pass
    return True, title, is_live


class YouTubeSource(BaseModel):
    url: str                 # YouTube 영상 또는 라이브 URL
    name: str = ""
    min_area: int = 600
    quality: str = "480p,360p,best"


@app.post("/api/cameras/youtube")
async def add_youtube_source(req: YouTubeSource):
    """
    YouTube 영상/라이브를 카메라 소스로 추가
    streamlink + ffmpeg 파이프라인으로 실시간 스트리밍

    - **url**: YouTube URL (라이브 또는 일반 영상)
    - **name**: 표시 이름
    - **min_area**: 최소 감지 면적 px²
    - **quality**: 화질 (480p, 360p, 720p, best 등)
    """
    if not _is_youtube_url(req.url):
        raise HTTPException(400, "유효한 YouTube URL이 아닙니다.")

    try:
        available, title, is_live = await asyncio.get_event_loop().run_in_executor(
            None, _check_youtube_live, req.url
        )
    except Exception as e:
        raise HTTPException(400, f"YouTube 스트림 확인 실패: {str(e)}")

    if not available:
        raise HTTPException(400, "사용 가능한 스트림을 찾을 수 없습니다.")

    name = req.name or title or ("YouTube 라이브" if is_live else "YouTube 영상")
    stream = cam_manager.add_youtube_live(
        url=req.url, name=name, quality=req.quality,
    )
    ok = stream.connect(min_area=req.min_area)
    return {
        "success": ok,
        "camera_id": stream.info.camera_id,
        "status": stream.info.status.value,
        "is_live": is_live,
        "error": stream.info.last_error or None,
    }


class CameraUpdateSettings(BaseModel):
    target_fps: Optional[int] = None
    min_area: Optional[int] = None


@app.patch("/api/cameras/{camera_id}")
async def update_camera_settings(camera_id: str, settings: CameraUpdateSettings):
    """카메라 트래킹 설정 변경 (연결 유지)"""
    stream = cam_manager.cameras.get(camera_id)
    if not stream:
        raise HTTPException(404, "카메라를 찾을 수 없습니다.")
    if settings.target_fps is not None:
        stream._target_fps = settings.target_fps
    if settings.min_area is not None:
        stream._min_contour_area = settings.min_area
    return {"success": True, "camera_id": camera_id}


# ------------------------------------------------------------------
# 주차 구역/라인 설정 (detection 서버 → MotionTracker에 전달)
# ------------------------------------------------------------------

class ParkingLineConfig(BaseModel):
    id: str
    name: str
    type: str           # "entry" | "exit" | "both"
    x1: float
    y1: float
    x2: float
    y2: float
    zone_id: Optional[str] = None


class ParkingZoneConfig(BaseModel):
    id: str
    name: str
    label: str
    x1: float
    y1: float
    x2: float
    y2: float


class ParkingConfig(BaseModel):
    camera_id: str
    zones: list = []
    lines: list = []


@app.post("/api/parking/config")
async def set_parking_config(cfg: ParkingConfig):
    """
    카메라에 주차 구역/라인 설정을 적용.
    프론트엔드(관리자)에서 구역 설정 후 호출.
    """
    stream = cam_manager.cameras.get(cfg.camera_id)
    if not stream:
        raise HTTPException(404, f"카메라 {cfg.camera_id}를 찾을 수 없습니다.")

    tracker = stream._tracker

    # 구역 설정
    tracker.set_zones(cfg.zones)

    # 라인 설정
    tracker.set_lines(cfg.lines)

    # 웹훅 설정 (입출차 이벤트 → 백엔드)
    tracker.set_webhook(BACKEND_WEBHOOK_URL, cfg.camera_id)

    return {
        "success": True,
        "camera_id": cfg.camera_id,
        "zones": len(cfg.zones),
        "lines": len(cfg.lines),
    }


@app.get("/api/parking/config/{camera_id}")
async def get_parking_config(camera_id: str):
    """현재 카메라의 주차 설정 조회"""
    stream = cam_manager.cameras.get(camera_id)
    if not stream:
        raise HTTPException(404, f"카메라 {camera_id}를 찾을 수 없습니다.")

    tracker = stream._tracker
    return {
        "camera_id": camera_id,
        "zones": tracker._zones,
        "lines": tracker._lines,
    }


@app.get("/api/parking/events/{camera_id}")
async def get_parking_events(camera_id: str):
    """카메라의 최근 입출차 이벤트 조회"""
    stream = cam_manager.cameras.get(camera_id)
    if not stream:
        raise HTTPException(404, f"카메라 {camera_id}를 찾을 수 없습니다.")

    return {
        "camera_id": camera_id,
        "events": stream._tracker.get_recent_events(),
    }


# ------------------------------------------------------------------
# WebSocket — 실시간 스트리밍
# ------------------------------------------------------------------
@app.websocket("/ws/stream/{camera_id}")
async def websocket_stream(websocket: WebSocket, camera_id: str):
    """
    WebSocket을 통해 실시간 프레임 + 감지 결과 스트리밍

    클라이언트에 전송하는 JSON:
    {
      "camera": {...},
      "frame": "data:image/jpeg;base64,...",
      "detection": { "total_detected", "zone_summary", "vehicles", ... }
    }
    """
    await websocket.accept()

    stream = cam_manager.cameras.get(camera_id)
    if not stream:
        await websocket.send_json({"error": f"카메라 {camera_id}를 찾을 수 없습니다."})
        await websocket.close()
        return

    try:
        while True:
            data = stream.get_latest()
            if data and data.get("frame"):
                await websocket.send_json({
                    "camera": data["camera"],
                    "frame": data["frame"],
                    "detection": data.get("detection"),
                })
            # 클라이언트에서 메시지 수신 확인 (ping/pong 대용)
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.5)
                if msg == "close":
                    break
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ------------------------------------------------------------------
# 실행
# ------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    uvicorn.run("app:app", host=HOST, port=PORT, reload=True)
