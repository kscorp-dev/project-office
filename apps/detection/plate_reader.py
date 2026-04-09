"""
번호판 인식 모듈 — EasyOCR 기반
차량 바운딩박스에서 번호판 영역을 검출하고 한국 번호판 전체를 인식한다.
"""
import re
import threading
from typing import Optional, Dict, Tuple, List

import cv2
import numpy as np


# 한국 번호판 형식 정규식
# 신형: 123가4567 (3숫자 + 한글1 + 4숫자)
# 구형: 12가3456 (2숫자 + 한글1 + 4숫자)
# 지역: 서울12가3456 (지역 + 2숫자 + 한글1 + 4숫자)
_KR_PLATE_PATTERNS = [
    # 신형: 123가4567
    re.compile(r'(\d{2,3})\s*([가-힣])\s*(\d{4})'),
    # 지역 포함: 서울12가3456
    re.compile(r'([가-힣]{2})\s*(\d{2,3})\s*([가-힣])\s*(\d{4})'),
]

# 번호판에 사용되는 한글 글자
_PLATE_CHARS = set('가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후배')


class PlateReader:
    """
    차량 이미지에서 한국 번호판을 인식.
    - 차량 하단부에서 번호판 후보 영역 자동 검출
    - EasyOCR (ko+en)으로 문자 인식
    - 한국 번호판 패턴 매칭 (신형/구형/지역)
    - 결과 캐싱 + 점진적 업데이트
    """

    def __init__(self):
        self._reader = None
        self._loading = False
        self._ready = False
        self._lock = threading.Lock()

        # 트랙 ID별 인식 결과 캐시
        self._cache: Dict[int, str] = {}
        # 트랙 ID별 인식 시도 횟수 (과도한 재시도 방지)
        self._attempts: Dict[int, int] = {}
        self._max_attempts = 8

        # 백그라운드로 모델 로드 시작
        self._load_thread = threading.Thread(target=self._load_model, daemon=True)
        self._load_thread.start()

    def _load_model(self):
        """EasyOCR 모델 로드 (백그라운드)"""
        self._loading = True
        try:
            import easyocr
            self._reader = easyocr.Reader(
                ['ko', 'en'],
                gpu=True,
                verbose=False,
            )
            self._ready = True
            print("[PlateReader] EasyOCR model loaded (ko+en)")
        except Exception as e:
            print(f"[PlateReader] Failed to load: {e}")
        finally:
            self._loading = False

    @property
    def is_ready(self) -> bool:
        return self._ready

    # ------------------------------------------------------------------
    # 번호판 영역 후보 검출
    # ------------------------------------------------------------------
    def _find_plate_candidates(self, vehicle_crop: np.ndarray) -> List[np.ndarray]:
        """차량 이미지에서 번호판 후보 영역들을 반환"""
        h, w = vehicle_crop.shape[:2]
        candidates = []

        # 1) 하단 40% (일반 차량 — 앞/뒤 번호판)
        bottom = vehicle_crop[int(h * 0.6):h, :]
        if bottom.size > 0:
            candidates.append(bottom)

        # 2) 하단 60% (트럭/버스 — 번호판이 중앙에 있을 수 있음)
        mid_bottom = vehicle_crop[int(h * 0.4):h, :]
        if mid_bottom.size > 0:
            candidates.append(mid_bottom)

        # 3) 윤곽선 기반 번호판 검출 시도
        gray = cv2.cvtColor(vehicle_crop, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 50, 150)

        # 모폴로지 연산으로 번호판 사각형 강화
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            aspect = cw / max(ch, 1)
            area = cw * ch

            # 번호판 비율: 가로/세로 2~6, 최소 면적
            if 2.0 <= aspect <= 6.0 and area >= (w * h * 0.005):
                # 약간 패딩
                px = max(0, x - 5)
                py = max(0, y - 5)
                px2 = min(w, x + cw + 5)
                py2 = min(h, y + ch + 5)
                plate_crop = vehicle_crop[py:py2, px:px2]
                if plate_crop.size > 0:
                    candidates.append(plate_crop)

        return candidates

    # ------------------------------------------------------------------
    # OCR 전처리
    # ------------------------------------------------------------------
    def _preprocess(self, crop: np.ndarray) -> List[np.ndarray]:
        """OCR 성능 향상을 위한 여러 전처리 버전 생성"""
        results = []
        h, w = crop.shape[:2]

        # 최소 크기 보장
        if w < 120:
            scale = 120 / w
            crop = cv2.resize(crop, (int(w * scale), int(h * scale)),
                              interpolation=cv2.INTER_CUBIC)

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

        # 버전 1: 히스토그램 평활화
        eq = cv2.equalizeHist(gray)
        results.append(eq)

        # 버전 2: 적응적 이진화 (어두운 번호판에 효과적)
        adaptive = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 25, 10,
        )
        results.append(adaptive)

        # 버전 3: OTSU 이진화
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        results.append(otsu)

        return results

    # ------------------------------------------------------------------
    # 한국 번호판 패턴 매칭
    # ------------------------------------------------------------------
    @staticmethod
    def _match_kr_plate(text: str) -> Optional[str]:
        """OCR 텍스트에서 한국 번호판 패턴을 추출"""
        # 공백/특수문자 정리
        cleaned = text.replace(' ', '').replace('-', '').replace('.', '')

        # 지역+번호 패턴 (서울12가3456)
        m = re.search(r'([가-힣]{2})(\d{2,3})([가-힣])(\d{4})', cleaned)
        if m:
            region, num1, char, num2 = m.groups()
            return f"{region}{num1}{char}{num2}"

        # 신형/구형 (123가4567 또는 12가3456)
        m = re.search(r'(\d{2,3})([가-힣])(\d{4})', cleaned)
        if m:
            num1, char, num2 = m.groups()
            return f"{num1}{char} {num2}"

        return None

    @staticmethod
    def _extract_digits_fallback(text: str) -> Optional[str]:
        """패턴 매칭 실패 시 숫자+한글 조합 추출"""
        cleaned = text.replace(' ', '')
        # 한글 1글자가 포함된 숫자 시퀀스 찾기
        m = re.search(r'(\d{2,3})([가-힣])(\d{2,4})', cleaned)
        if m:
            return f"{m.group(1)}{m.group(2)} {m.group(3)}"
        # 숫자만이라도 4자리 이상 있으면
        digits = re.findall(r'\d', cleaned)
        if len(digits) >= 4:
            return ''.join(digits[-4:])
        return None

    # ------------------------------------------------------------------
    # 메인 인식
    # ------------------------------------------------------------------
    def read_plate(self, frame: np.ndarray, bbox: tuple, track_id: int) -> Optional[str]:
        """
        차량 바운딩박스에서 한국 번호판을 인식.

        Returns:
            "123가 4567" 형식의 번호판 문자열, 또는 None
        """
        if track_id in self._cache:
            return self._cache[track_id]

        if self._attempts.get(track_id, 0) >= self._max_attempts:
            return None

        if not self._ready:
            return None

        self._attempts[track_id] = self._attempts.get(track_id, 0) + 1

        try:
            x1, y1, x2, y2 = bbox
            fh, fw = frame.shape[:2]

            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(fw, x2), min(fh, y2)

            bw, bh = x2 - x1, y2 - y1
            if bw < 30 or bh < 30:
                return None

            vehicle_crop = frame[y1:y2, x1:x2]

            # 후보 영역 검출
            candidates = self._find_plate_candidates(vehicle_crop)

            best_plate = None
            best_conf = 0.0

            for crop in candidates:
                preprocessed = self._preprocess(crop)

                for pp in preprocessed:
                    with self._lock:
                        results = self._reader.readtext(
                            pp, detail=1, paragraph=False,
                            min_size=8, text_threshold=0.4, low_text=0.3,
                        )

                    if not results:
                        continue

                    # 전체 텍스트 합침
                    full_text = ' '.join(r[1] for r in results)
                    avg_conf = sum(r[2] for r in results) / len(results)

                    # 한국 번호판 패턴 매칭
                    plate = self._match_kr_plate(full_text)
                    if plate and avg_conf > best_conf:
                        best_plate = plate
                        best_conf = avg_conf
                        if avg_conf > 0.7:
                            break  # 높은 신뢰도면 즉시 사용

                    # 패턴 매칭 실패 시 폴백
                    if not best_plate:
                        fallback = self._extract_digits_fallback(full_text)
                        if fallback and avg_conf > best_conf:
                            best_plate = fallback
                            best_conf = avg_conf

                if best_plate and best_conf > 0.7:
                    break

            if best_plate:
                self._cache[track_id] = best_plate
                return best_plate

        except Exception:
            pass

        return None

    def get_cached(self, track_id: int) -> Optional[str]:
        """캐시된 번호판 반환"""
        return self._cache.get(track_id)

    def clear_track(self, track_id: int):
        """트랙 삭제 시 캐시 정리"""
        self._cache.pop(track_id, None)
        self._attempts.pop(track_id, None)
