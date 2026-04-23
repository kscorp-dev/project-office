# Project Office v0.13.0

사내 업무 통합 플랫폼 - 전자결재, 메신저, CCTV, 근태관리, 작업지시서 외 12개 모듈

> **Production**: [https://43-200-29-148.sslip.io](https://43-200-29-148.sslip.io)

## 기능 모듈 (12개)

| # | 모듈 | 주요 기능 | 상태 |
|---|------|----------|------|
| 1 | 인증/조직관리 | JWT 인증, RBAC, 조직도, 인사관리, 직원등록 | Done |
| 2 | 전자결재 | 결재선, 위임/대결, 양식관리, 문서함 | Done |
| 3 | 메신저 | 1:1/그룹 채팅, 읽음확인, 멘션, 파일전송/수신 | Done |
| 4 | CCTV 모니터링 | RTSP→HLS 스트리밍, PTZ, 녹화 재생, YOLO 감지 | Done |
| 5 | 근태관리 | GPS/IP 출퇴근, 휴가, 연차 자동부여 | Done |
| 6 | 캘린더 | 개인/공유 일정, 결재/근태 연동 | Done |
| 7 | 게시판 | 공지사항, 필독, 부서별 게시판 | Done |
| 8 | 작업지시서 | 6단계 워크플로우, 발주/대금청구 | Done |
| 9 | 재고관리 | 입출고, 재고실사, 통계 대시보드 | Done |
| 10 | 화상회의 | WebRTC SFU, STT 음성인식, AI 회의록, TTS | Done |
| 11 | 문서관리 | 버전관리, 미리보기, 외부 공유링크, 뷰어 | Done |
| 12 | 관리자콘솔 | 모듈 ON/OFF, 보안설정, 감사로그 | Done |

### 추가 시스템

| 모듈 | 설명 |
|------|------|
| 주차관리 | 입출차, 차량번호 인식, 구역 위치, 4면 촬영, 담당자 알림 |
| **메일** | **AWS WorkMail 통합** — 받은편지함/발송/폴더 관리/첨부 100MB/주소록 자동완성/실시간 알림(IMAP IDLE + Socket.IO)/관리자 계정 CRUD |
| Detection (YOLO) | YOLOv8+ByteTrack 차량 추적, 번호판 인식 |

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | Node.js 20 / Express / TypeScript / Prisma / Socket.IO |
| Web | React 18 / TypeScript / Vite / Zustand / Tailwind + shadcn/ui |
| Mobile | React Native 0.76+ / Expo SDK 52+ / TypeScript / Expo Router |
| Detection | Python 3.11 / FastAPI / YOLOv8 / ByteTrack / EasyOCR |
| DB | PostgreSQL 16 / Redis 7 |
| 실시간 | WebSocket (Socket.IO) / WebRTC |
| AI | Claude API (회의록) / Whisper (STT) / TTS 음성 안내 |
| Infra | AWS EC2 / Docker Compose / Nginx / Let's Encrypt |
| CI/CD | GitHub Actions (SSH deploy) |

## 프로젝트 구조

```
project-office/
├── apps/
│   ├── backend/          # API 서버 (Express + Prisma)
│   ├── web/              # 웹 프론트엔드 (React + Vite)
│   ├── mobile/           # 모바일 앱 (Expo + EAS Build)
│   └── detection/        # 차량 감지 서비스 (Python + YOLO)
├── packages/
│   └── shared/           # 공유 타입/유틸리티
├── scripts/
│   └── deploy.sh         # 배포 스크립트
├── .github/
│   └── workflows/
│       └── deploy.yml    # CI/CD 파이프라인
├── docker-compose.yml    # 프로덕션 컨테이너 구성
├── package.json          # 모노레포 루트 (npm workspaces)
└── turbo.json            # Turborepo 빌드 설정
```

## 시작하기

### 사전 요구사항
- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Docker & Docker Compose (배포 시)

### 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버
npm run dev:backend     # API (http://localhost:3000)
npm run dev:web         # 웹 (http://localhost:5173)
npm run dev:mobile      # 모바일 (Expo)
npm run dev:detection   # YOLO 감지 (http://localhost:8100)
```

### 테스트

```bash
# Backend (118 유닛/통합 테스트 — 일부 통합 테스트는 PostgreSQL 필요)
cd apps/backend
npm test                    # 전체 실행
npm run test:unit          # 유닛만
npm run test:integration   # DB 필요한 통합 테스트
npm run test:coverage      # 커버리지 리포트

# Web (28 유닛 테스트 — jsdom)
cd apps/web
npm test
```

### Docker 배포

```bash
# .env 파일 설정 (.env.example 참고)
cp .env.example .env

# 전체 서비스 실행
docker-compose up -d --build

# Detection 포함 실행
docker-compose --profile detection up -d --build

# 상태 확인
docker-compose ps
```

## 배포 환경

### 인프라 구성

| 항목 | 설정 |
|------|------|
| 서버 | AWS EC2 (ap-northeast-2) |
| IP | 43.200.29.148 (Elastic IP) |
| HTTPS | Let's Encrypt + Nginx 리버스 프록시 |
| 도메인 | 43-200-29-148.sslip.io |
| CI/CD | GitHub Actions → SSH deploy |

### 컨테이너 구성

| 서비스 | 내부 포트 | 설명 |
|--------|----------|------|
| web | 80 | Nginx로 React SPA 서빙 |
| backend | 3000 | Express API + Socket.IO |
| postgres | 5432 | PostgreSQL 16 (127.0.0.1 바인딩) |
| redis | 6379 | Redis 7 (127.0.0.1 바인딩) |
| detection | 8100 | YOLO 감지 (프로필 활성화 시) |

### 보안 설정

- HTTPS 강제 (HTTP→443 리다이렉트)
- HTTP/2 활성화
- 보안 헤더: HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy
- DB/Redis 포트 외부 비노출 (127.0.0.1 바인딩 + Security Group 차단)
- .env 파일 퍼미션 600
- Express trust proxy + rate limiting
- Helmet.js 보안 미들웨어

### 자동화

| 작업 | 스케줄 | 설명 |
|------|--------|------|
| DB 백업 | 매일 02:00 UTC | pg_dump + gzip, 7일 보관 |
| 헬스 모니터링 | 5분 주기 | 서비스 다운 시 자동 재시작 |
| SSL 갱신 | 매주 월 03:00 UTC | Certbot auto-renew |

### 배포 스크립트

```bash
./scripts/deploy.sh deploy    # git pull + docker build + 실행
./scripts/deploy.sh build     # 컨테이너 재빌드
./scripts/deploy.sh restart   # 컨테이너 재시작
./scripts/deploy.sh logs      # 로그 보기
./scripts/deploy.sh status    # 상태 + 리소스 확인
./scripts/deploy.sh down      # 전체 중지
```

## 성능 최적화

- **코드 스플리팅**: Vite manualChunks (727KB → 294KB 메인 번들)
  - vendor-react, vendor-icons, vendor-network, vendor-grid, vendor-misc
- **Gzip 압축**: Nginx에서 JS/CSS/JSON/SVG 압축
- **정적 파일 캐시**: 7일 Cache-Control + immutable 헤더
- **Docker 멀티스테이지 빌드**: 최소 프로덕션 이미지

## 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| **v0.13.0** | **AI 자동 회의록 생성 (Phase 2 완성)**<br/>• Prisma 신규 모델 `MeetingTranscript` / `MeetingMinutes` + enum `MeetingMinutesStatus`(generating/draft/final/failed) migration<br/>• WebSocket `meeting:transcript` 이벤트에서 `isFinal=true` 발언만 DB 영속화 (speaker·text·timestamp)<br/>• `@anthropic-ai/sdk` 통합 — `services/minutes.service.ts` (~260줄)<br/>  - Claude Sonnet 4.5로 전사 전체를 구조화 JSON(summary/topics/decisions/actionItems)으로 변환<br/>  - 회의 종료(`POST /:id/end`) 시 비동기 트리거, 결과는 GET 폴링<br/>  - 코드펜스·설명문 제거, 파싱 실패 시 원문 fallback — 견고한 JSON 파서<br/>• 회의록 REST 5종 신규 — GET/PATCH/finalize/regenerate/transcripts<br/>  - 편집/확정은 호스트·관리자만, final 상태는 편집 거부, 관리자는 force=true로 재생성<br/>• 웹 신규 `/meeting/:id/minutes` 페이지 (~500줄)<br/>  - 상태 배지 + 3초 폴링(generating) / 인라인 편집(draft) / 잠금(final) / 실패 메시지<br/>  - 요약 / 주제 / 결정사항 / 액션아이템 4섹션 조회·편집 UI<br/>  - 원문 발언 기록 펼침 + 브라우저 인쇄(PDF)<br/>• 회의 목록에서 종료된 회의 상세 → "AI 회의록 열람" 진입 버튼<br/>• `config.anthropic.enabled` — API 키 없으면 failed 상태로 우아하게 기록, 로컬/테스트 환경 깨지지 않음<br/>• 신규 테스트 15건 (9 단위 JSON 파서 + 6 통합) → 전체 **103 → 118건 통과** |
| v0.12.0 | **화상회의 권한 보안 강화 + 모바일 WebRTC 실스트림 연동**<br/>• `services/meeting.service.ts` 신규 — `canJoinMeeting`/`canViewMeeting` 중앙 권한 로직<br/>• 문서 업로드/조회/다운로드 3개 엔드포인트에 권한 검증 추가 (비참가자 차단, 업로드 실패 시 임시파일 정리)<br/>• WebSocket `meeting:join` 서버측 검증 추가 — NOT_FOUND/ACCESS_DENIED/NOT_ACTIVE/CANCELLED 에러 코드 분리<br/>• 모바일: `react-native-webrtc` + `@config-plugins/react-native-webrtc` + `socket.io-client` 추가<br/>• `app.json` — iOS NSMicrophoneUsageDescription / Android RECORD_AUDIO·BLUETOOTH·WAKE_LOCK 등 권한 추가<br/>• `useWebRTCMobile` 훅 신규 (~250줄) — 웹 `useWebRTC`와 동일한 시그널링 프로토콜, `/meeting` 네임스페이스<br/>• 회의실 화면(room.tsx): `Constants.appOwnership` 기반 조건부 모듈 로드 → Expo Go(프리뷰) · Dev Client(실스트림) 동시 지원<br/>• `RTCView`로 로컬/원격 영상 실시간 렌더링, 전면 카메라 자동 mirror, `_switchCamera()` 전/후면 전환<br/>• mic/cam 토글이 실제 `RTCPeerConnection` 트랙 상태 변경 + `meeting:media-toggle` 브로드캐스트<br/>• 새 테스트 15건 (`meeting-access.test.ts`) — 호스트/초대자/참여이력/외부인/관리자/종료·취소 회의 전 시나리오 커버<br/>• 전체 테스트 스위트 88 → **103건** 통과 |
| v0.11.0 | **모바일 화상회의 UI/UX 구축**<br/>• `app/meeting/` 3개 화면 신규 (목록 · 상세 · 회의실)<br/>• 회의 목록: 상태별 필터 칩, FAB 생성, 진행중 라이브 표시<br/>• 회의 상세: 참가자 목록, 상태별 동적 CTA (시작/참여/종료/취소)<br/>• 회의실: 2x2 영상 그리드 + 하단 컨트롤(🎤📹🖥💬📞) + 채팅 바텀시트<br/>• 대시보드·더보기에서 화상회의 라우팅 연결 (이전엔 "준비 중" 알림)<br/>• 타입체크 통과, expo-router 파일기반 라우팅 완전 통합<br/>• ⚠ 실제 WebRTC 영상/음성은 EAS Dev Client 빌드 필요 (UI는 완성) |
| v0.10.0 | **관리자 메일 관리 UI + 실시간 알림 + 성능 최적화**<br/>• Step 1 — 관리자 콘솔 메일박스 생성/비밀번호 재설정/쿼터/삭제 UI<br/>• Step 2 — 직원 등록 시 WorkMail 계정 자동 생성 옵션 통합<br/>• Step 3 — 기존 WorkMail 계정 ↔ 앱 사용자 연결 UI (LinkMailboxModal)<br/>• Step 4 — IMAP IDLE + Socket.IO `/mail` 네임스페이스로 실시간 새 메일 알림<br/>  (토스트 + 사이드바 배지 + 브라우저 Notification + 자동 재연결)<br/>• 대시보드 "받은 메일" 위젯 추가 + 실시간 갱신<br/>• IMAP 연결 풀 (사용자별 2분 유휴) + stale-while-revalidate 캐시 전략<br/>  → 메일 탭 진입 속도 2~3초 → **11ms** (180배 개선)<br/>• 낙관적 UI (메일 상세 클릭 시 헤더 즉시, 본문만 loading)<br/>• Graceful shutdown hook (IMAP 풀 + IDLE 워커 정리) |
| v0.9.0 | **AWS WorkMail 통합 + 자체 메일 시스템 완전 구현**<br/>• WorkMail API로 관리자의 메일박스 생성/삭제/쿼터/비번재설정 자동화<br/>• IMAP/SMTP 직접 연동 (imapflow + nodemailer + mailparser)<br/>• Mail.tsx 실제 API 연동 (데모 제거), 본문 XSS sanitize, 100MB 첨부<br/>• 5분 주기 헤더 캐시 워커 (node-cron)<br/>• AES-256-GCM 비밀번호 암호화 + 감사 로그 (MailAdminLog)<br/>• 관리자 콘솔에 메일관리 탭 추가 (연결 상태/계정 목록) |
| v0.8.0 | **전면 코드 품질/보안/성능 강화 + 테스트 스위트 104건**<br/>• Prisma migrations 도입, 배포 블로커 5건 해결<br/>• JWT 시크릿 강제화, XSS(DOMPurify), MIME 교차검증, 토큰 persist<br/>• Error Boundary, Refresh race condition, 결재 낙관적 락, 권한 재검증<br/>• N+1 쿼리 제거, advisory lock 동시성, onDelete 정책, CSRF 방어<br/>• pino 구조화 로깅 + 중앙 에러 핸들러, nginx 보안 헤더 강화<br/>• Vitest 기반 단위/통합 테스트 104건 (XSS/Race/Cycle 검증 포함) |
| v0.7.3 | TypeScript 빌드 오류 전면 수정, AWS 배포, CI/CD, 보안 강화 |
| v0.7.2 | 메신저 파일 전송/수신, 문서 뷰어 |
| v0.7.1 | 관리자 직원 등록, AWS 배포 설정 |
| v0.7.0 | 다크모드, 대시보드 위젯 리사이즈 |
| v0.6.0 | WebRTC 화상회의, TTS 음성 안내 |
| v0.5.0 | YOLO+ByteTrack 차량 추적, 번호판 인식 |
| v0.4.x | React Native 모바일 앱, CCTV 실시간 트래킹, 주차 감지 |
| v0.3.x | 대시보드 리디자인, 화상회의 STT, 사이드바 커스터마이징, 주차관리, 메일 |
| v0.2.0 | Phase 1~4 전체 기능 구현 (12개 모듈) |

## 문서

- [기술 스택 변경](docs/00-기술스택-변경.md)
- [시스템 아키텍처](docs/01-시스템-아키텍처.md)
- [데이터베이스 설계](docs/02-데이터베이스-설계.md)
- [API 설계](docs/03-API-설계.md)
- [보안 아키텍처](docs/04-보안-아키텍처.md)
- [기능명세서](docs/기능명세/) (10개 문서)

## 라이선스

Private - KSCorp
