# Project Office

사내 업무 통합 플랫폼 - 전자결재, 메신저, CCTV 모니터링

## 주요 기능

### 1. 전자결재
- 결재 문서 작성 및 상신
- 결재선 설정 (순차/병렬 결재)
- 결재 승인/반려/보류
- 결재 문서 템플릿 관리
- 결재 이력 및 현황 조회

### 2. 메신저
- 1:1 / 그룹 채팅
- 파일 첨부 및 공유
- 읽음 확인
- 푸시 알림
- 채팅방 검색

### 3. CCTV 모니터링
- 실시간 CCTV 영상 스트리밍
- 다중 카메라 뷰
- 녹화 영상 재생
- 카메라 제어 (PTZ)
- 이벤트 알림

## 지원 플랫폼

| 플랫폼 | 기술 스택 |
|--------|----------|
| Web (PC) | React + TypeScript |
| iOS | Swift + SwiftUI |
| Android | Kotlin + Jetpack Compose |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Redis |
| Real-time | WebSocket (Socket.IO) |
| Streaming | RTSP / HLS |

## 프로젝트 구조

```
project-office/
├── backend/          # API 서버 (Node.js + Express)
│   └── src/
│       ├── config/       # 환경 설정
│       ├── controllers/  # 컨트롤러
│       ├── middleware/   # 미들웨어
│       ├── models/       # 데이터 모델
│       ├── routes/       # 라우트
│       ├── services/     # 비즈니스 로직
│       ├── utils/        # 유틸리티
│       └── websocket/    # WebSocket 핸들러
├── web/              # 웹 프론트엔드 (React)
│   └── src/
│       ├── assets/       # 정적 리소스
│       ├── components/   # 공통 컴포넌트
│       ├── pages/        # 페이지
│       ├── services/     # API 서비스
│       ├── store/        # 상태 관리
│       ├── styles/       # 스타일
│       └── utils/        # 유틸리티
├── ios/              # iOS 앱 (Swift + SwiftUI)
│   └── ProjectOffice/
│       ├── Views/        # SwiftUI 뷰
│       ├── ViewModels/   # 뷰모델
│       ├── Models/       # 데이터 모델
│       ├── Services/     # 네트워크/서비스
│       ├── Utils/        # 유틸리티
│       └── Resources/    # 리소스
├── android/          # Android 앱 (Kotlin + Jetpack Compose)
│   └── app/src/main/java/com/kscorp/projectoffice/
│       ├── ui/           # UI 컴포넌트
│       ├── data/         # 데이터 레이어
│       ├── domain/       # 도메인 레이어
│       ├── di/           # 의존성 주입
│       └── util/         # 유틸리티
└── docs/             # 문서
```

## 시작하기

### 사전 요구사항
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Xcode 15+ (iOS 개발)
- Android Studio (Android 개발)

### Backend 실행
```bash
cd backend
npm install
npm run dev
```

### Web 실행
```bash
cd web
npm install
npm run dev
```

## 라이선스

Private - KSCorp
