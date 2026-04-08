# Project Office v0.2.0

사내 업무 통합 플랫폼 - 전자결재, 메신저, CCTV, 근태관리, 작업지시서 외 12개 모듈

## 기능 모듈 (12개)

| # | 모듈 | 주요 기능 | Phase |
|---|------|----------|-------|
| 1 | 인증/조직관리 | JWT 인증, RBAC, 조직도, 인사관리 | 1 |
| 2 | 전자결재 | 결재선, 위임/대결, 양식관리, 문서함 | 1 |
| 3 | 메신저 | 1:1/그룹 채팅, 읽음확인, 멘션, 파일공유 | 1 |
| 4 | CCTV 모니터링 | RTSP→HLS 스트리밍, PTZ, 녹화 재생 | 2 |
| 5 | 근태관리 | GPS/IP 출퇴근, 휴가, 연차 자동부여 | 2 |
| 6 | 캘린더 | 개인/공유 일정, 결재/근태 연동 | 2 |
| 7 | 게시판 | 공지사항, 필독, 부서별 게시판 | 2 |
| 8 | 작업지시서 | 6단계 워크플로우, 발주/대금청구 (TOPAZ 통합) | 3 |
| 9 | 재고관리 | 입출고, 재고실사, 통계 대시보드 | 3 |
| 10 | 화상회의 | WebRTC SFU, STT, AI 자동 회의록 | 4 |
| 11 | 문서관리 | 버전관리, 미리보기, 외부 공유링크 | 4 |
| 12 | 관리자콘솔 | 모듈 ON/OFF, 보안설정, 감사로그 | 4 |

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | Node.js 20+ / Express / TypeScript / Prisma / Socket.IO |
| Web | React 18 / TypeScript / Vite / Zustand / Tailwind + shadcn/ui |
| Mobile | React Native 0.76+ / Expo SDK 52+ / TypeScript / Expo Router |
| DB | PostgreSQL 15+ / Redis 7+ |
| 실시간 | WebSocket (Socket.IO) / WebRTC (mediasoup) |
| 영상 | FFmpeg (RTSP→HLS) |
| AI | Claude API (회의록) / Whisper (STT) |

## 프로젝트 구조 (모노레포)

```
project-office/
├── apps/
│   ├── backend/          # API 서버 (Node.js + Express)
│   ├── web/              # 웹 프론트엔드 (React + Vite)
│   └── mobile/           # 모바일 앱 (React Native + Expo)
├── packages/
│   └── shared/           # 공유 코드 (Types, API, Validation, Utils)
├── docs/                 # 기획 문서
├── package.json          # 루트 (npm workspaces)
└── turbo.json            # 모노레포 빌드 설정
```

## 시작하기

### 사전 요구사항
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Expo CLI (`npm install -g expo-cli`)

### 설치
```bash
npm install          # 루트에서 전체 의존성 설치
```

### 실행
```bash
npm run dev:backend  # API 서버 (http://localhost:3000)
npm run dev:web      # 웹 앱 (http://localhost:5173)
npm run dev:mobile   # 모바일 앱 (Expo)
```

## 문서

- [기술 스택 변경](docs/00-기술스택-변경.md)
- [시스템 아키텍처](docs/01-시스템-아키텍처.md)
- [데이터베이스 설계](docs/02-데이터베이스-설계.md)
- [API 설계](docs/03-API-설계.md)
- [보안 아키텍처](docs/04-보안-아키텍처.md)
- [기능명세서](docs/기능명세/) (10개 문서)

## 라이선스

Private - KSCorp
