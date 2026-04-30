# Project Office v0.22.0

사내 업무 통합 플랫폼 - 전자결재, 메신저, CCTV, 근태관리, 작업지시서 외 12개 모듈

> **Production**: [https://43-200-29-148.sslip.io](https://43-200-29-148.sslip.io)
> **Phase 2 진행** — 메일 답장/전달 / 캘린더 월간 그리드 / 자재 바코드 스캔

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
# Backend (305 유닛/통합 테스트 — 일부 통합 테스트는 PostgreSQL 필요)
cd apps/backend
npm test                    # 전체 실행
npm run test:unit          # 유닛만
npm run test:integration   # DB 필요한 통합 테스트
npm run test:coverage      # 커버리지 리포트

# Web (28 유닛 테스트 — jsdom)
cd apps/web
npm test

# Mobile (정적 검증)
cd apps/mobile
npm run typecheck          # TypeScript 타입체크
npm run verify:build       # EAS 빌드 직전 36개 체크 (CallKit/APNs/권한)
```

### 모바일 빌드 (EAS)

```bash
cd apps/mobile
npm run build:dev:ios       # 개발 iOS (실기기)
npm run build:dev:android   # 개발 Android (실기기)
npm run build:preview       # TestFlight 후보
npm run build:prod          # 프로덕션 릴리스
```

자세한 절차는 [모바일 빌드 가이드](docs/모바일-빌드-가이드.md) 참조.

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
| **v0.22.0** | **Phase 2 진행 — 메일 답장/전달 + 캘린더 월간 뷰 + 자재 바코드 스캔**<br/>v1.0 GA 직전 모바일 사용자가 가장 자주 손이 가는 3가지 영역. 모두 모바일 풀스택, 백엔드 추가는 자재 lookup 1종.<br/>**① 메일 답장/전달 (Phase 2-A, 기획서 §8.5 + Week 5)**<br/>• `app/mail/[uid].tsx` 신규 — 메일 상세 + 첨부 다운로드 + 답장/전체답장/전달 액션바<br/>  - HTML 본문은 `stripHtml()` 로 텍스트 변환 (script/style 제거 + 엔티티 디코드)<br/>  - 첨부는 `expo-file-system` 캐시 다운로드 → `expo-sharing` 시스템 공유시트<br/>• `app/mail/compose.tsx` 신규 — 신규/답장/전달 통합 작성 화면<br/>  - mode 파라미터로 Re:/Fwd: 자동 prefix + 인용 본문(>) 자동 삽입<br/>  - 전체답장 시 cc 자동 보존, 답장 시 fromEmail 자동 to<br/>  - 사진(image picker) + 파일(document picker) 첨부, 단일 25MB·10개 제한<br/>• 메일 탭 onPress 라우팅 + ✉️ FAB 추가, expo-file-system / expo-sharing 의존성<br/>**② 캘린더 월간 그리드 (Phase 2-B, Week 6)**<br/>• 기존 단순 향후 2주 리스트 → 6주 × 7일 월간 그리드로 전면 재작성<br/>• 헤더에서 이전/다음 월 이동 + 월 라벨 탭으로 오늘 이동<br/>• 셀별 일정 dot 최대 3개 + 초과 시 + 표시, 멀티-데이 일정도 모든 날짜에 등록<br/>• 일/토 색상 구분, 오늘/선택일 강조, 이번 달 외 dim<br/>• 하단 패널: 선택일 이벤트 카드 (시간/제목/설명/장소/카테고리/작성자)<br/>• FAB → 일정 추가 모달: 제목 / 날짜 / 종일 토글 / 시작·종료 / 장소 / 카테고리 칩 / 설명<br/>• POST /calendar/events 후 즉시 grid refetch<br/>**③ 자재 바코드 스캔 (Phase 2-C, Week 9)**<br/>• 백엔드: `GET /api/inventory/lookup?code=XXX`<br/>  - InventoryItem.code 정확 일치, isActive=true 만 매칭, trim 처리<br/>  - 비활성 자재 404 (스캐너에서 폐기 자재 안 보이게)<br/>• 모바일: 검색창 옆 📷 스캔 버튼 → ScannerModal<br/>  - expo-camera SDK 52 의 `CameraView` 내장 바코드 스캔 (별도 라이브러리 X)<br/>  - 13가지 형식 (qr / code128 / ean13 / pdf417 / datamatrix / codabar 등)<br/>  - 가이드 프레임 + 4 모서리 마커, 같은 코드 1초 이내 중복 스캔 무시<br/>  - 권한 미허용 시 안내 + 닫기 버튼<br/>• ScanResultModal — 자재명/코드/규격/카테고리 + 현재 재고 강조 박스<br/>  - 부족 시 빨강, 충분 시 초록 (다크모드 대응), "다시 스캔" / "확인" 액션<br/>**④ 검증**<br/>• 백엔드 테스트 **299 → 305 (+6)** (inventory-lookup.test.ts)<br/>• TypeScript 백엔드 / 모바일 모두 깨끗<br/>• 모바일 verify:build 36/36 통과 |
| v0.21.0 | **Phase 1 잔여 — 대시보드 통합 / 결재 위임/대결 / 그룹 채팅 멤버 관리**<br/>v0.20.0 마무리 후 v1.0 GA 직전에 남았던 "운영에서 매일 쓰지만 막상 손이 안 갔던" 3가지 영역을 한 번에 정렬. 모두 백엔드 + 모바일 풀스택 + 테스트까지.<br/>**① 대시보드 통합 stats (Phase 1-A)**<br/>• `GET /api/dashboard/summary` — 7개 카운트(결재 대기 / 위임받은 결재 대기 / 메신저 미읽음 / 알림 / 오늘 일정 / 진행중 작업 / 출근 여부) 한 번에<br/>• 메신저 미읽음은 raw SQL 단일 쿼리 (lastReadAt 기준)<br/>• 모바일 dashboard.tsx 의 4 카드 하드코딩 제거 → 실데이터, 카드 탭 시 모듈 진입<br/>• 위임 받은 결재 있을 때만 노란 배너 자동 노출<br/>**② 결재 위임/대결 (Phase 1-B)**<br/>• `ApprovalDelegation` 모델은 v0.5 부터 schema 에만 있던 미구현 잔재. 이 릴리스로 완성<br/>• `ApprovalLine.actedByUserId` (FK to User) 추가 — 위임 처리한 사람 기록<br/>• `delegation.service.ts` — `canActOnLine(line, userId)` 로 본인/위임자 권한 통합<br/>• approve/reject 가 자동으로 위임 권한 인식, [대결] 코멘트 prefix 자동 붙임, 휴가 후처리는 원래 결재자 기준<br/>• REST: GET/POST/DELETE `/api/approvals/delegations`<br/>  - 자기 자신 차단, 과거 기간 차단, 비활성 사용자 차단<br/>  - 본인 또는 admin 만 취소<br/>• 모바일 `app/settings/delegation.tsx` 신규 — outgoing/incoming 목록 + 사용자 검색 모달 + 활성/예정/비활성 뱃지<br/>**③ 메신저 그룹 멤버 관리 (Phase 1-C)**<br/>• REST 3종:<br/>  - GET `/messenger/rooms/:id` (룸 정보 + 활성 멤버)<br/>  - POST `/messenger/rooms/:id/members` (추가, 그룹만)<br/>  - DELETE `/messenger/rooms/:id/members/:userId` (본인 leave / 방장이 타인 제거)<br/>• 떠난 사용자 재추가 시 leftAt=null + joinedAt 갱신 (재합류 흐름)<br/>• 멤버 변경마다 system 메시지 자동 작성 ("X님이 Y님을 초대했습니다")<br/>• WebSocket `/messenger` 에 `room:members:added` / `removed` emit<br/>• 모바일: 그룹 룸 헤더 우측 👥 버튼 → `RoomMembersModal` (방장/본인 뱃지, 내보내기/나가기, 사용자 검색 + 추가)<br/>**④ 검증**<br/>• Prisma migration `20260430000000_add_delegation_acted_by`<br/>• 백엔드 테스트 **266 → 299 (+33)** 모두 통과 — P1-A 7 / P1-B 13 / P1-C 13<br/>• TypeScript 백엔드 / 모바일 모두 깨끗 |
| v0.20.0 | **Phase 1 모바일 마무리 — 다크모드 전면 / 인라인 푸시 / CallKit / GPS 지오펜스 / EAS 빌드 검증**<br/>v0.19.0 이후 모바일 앱이 "PoC" 단계에서 "운영 가능" 단계로 도약. 푸시·다크모드·CallKit·GPS 모두 실제 회사 환경에서 즉시 사용 가능한 수준.<br/>**① GPS 지오펜스 출퇴근** (부록 A.5 P0)<br/>• Haversine 거리 계산 + 회사 좌표 / 반경 50–500m 설정<br/>• `attendance.routes.ts` POST /clock-in / clock-out에서 GPS 좌표 검증<br/>• 모바일 위치 권한 요청 + 자동 좌표 수집 + 거리 표시<br/>• 14건 신규 테스트 (Haversine + 경계 케이스 + 권한 미허용)<br/>**② 푸시 인라인 액션 + 딥링크** (Phase 1 마무리)<br/>• iOS Notification Categories — 결재 [✓ 승인]/[✕ 반려], 메신저 [답장]/[읽음 처리]<br/>• 결재: 잠금화면 길게누름 → 생체인증 후 즉시 승인/반려 가능<br/>• 메신저: 잠금화면에서 textInput으로 빠른 답장<br/>• 백엔드 `mapToMobilePayload` — DB enum 17종 → 모바일 단순 type 7종 매핑<br/>• 모바일 `resolveDeepLink` — 알림 탭 시 결재/메신저/메일/회의/작업/휴가/게시판 진입<br/>**③ 작업지시서 모바일 상세 화면** (P1)<br/>• 카메라/사진 라이브러리/파일 첨부 — multipart/form-data 업로드<br/>• 6단계 워크플로우 (draft/sent/in_progress/completed/cancelled) UI 전환<br/>• 체크리스트 토글 + 댓글 + 디자인파일 버전 관리<br/>**④ 다크모드 전면 적용 (15+ 화면)**<br/>• `useTheme` 훅 + `makeStyles(c, isDark)` 패턴<br/>• SemanticColors (bg/surface/text/border/divider/highlight/scrim)<br/>• 결재/메신저/메일/회의/대시보드/조직도/근태/캘린더/게시판/작업지시서/재고/주차/CCTV/관리/내정보/앱설정 — 시스템 테마 자동 추종<br/>• WebRTC 영상 화면은 의도적으로 항상 어둡게 유지, 채팅 바텀시트만 테마 대응<br/>**⑤ CallKit/CallKeep 통합 — 회의 초대 + 즉시 호출**<br/>• POST /meeting 생성 시 참가자에게 `meeting_invited` 알림 자동 발사<br/>• POST /meeting/:id/ring (호스트 전용) — 진행중 회의에서 참가자 즉시 호출, meta.ring=true<br/>• 모바일: 포그라운드에선 `displayIncomingMeetingCall()` 풀스크린 UI, 잠금화면에선 OS 인라인 [✓ 수락]/[✕ 거절] 버튼<br/>• 거절 시 호스트에게 통화 거절 알림 자동 발사 (POST /meeting/:id/decline)<br/>**⑥ 모바일 dev/preview/production 빌드 인프라**<br/>• `npm run verify:build` — 36개 항목 자동 점검 (UIBackgroundModes voip / 권한 / config plugin / eas.json env / Notification Category)<br/>• `with-aps-environment.js` config plugin — EXPO_PUBLIC_APS_ENV로 entitlement 분기 (dev/prod 토큰 silent fail 방지)<br/>• eas.json 4개 프로파일 (development / development-simulator / preview / production)<br/>**⑦ 푸시 운영 진단**<br/>• 서버 부팅 시 `pushHealthCheck()` 1회 자동 호출 + 로그 (EXPO_ACCESS_TOKEN / DISABLE_PUSH / 활성 디바이스 수)<br/>• `GET /admin/push/health` — 운영자가 monitoring 시스템에서 5분마다 호출 가능<br/>• `POST /admin/push/test` + 모바일 관리자 화면 "📲 테스트 푸시 발송" 버튼<br/>**⑧ 백엔드 테스트 159 → 266 (+67%)**<br/>• 21건 — `mapToMobilePayload` 매핑 (DB enum → 모바일 페이로드)<br/>• 15건 — push 통합 (createNotification → sendPushToUser contract)<br/>• 7건 — `/meeting/:id/ring` `/decline` HTTP 라우트<br/>• 6건 — `/admin/push/health` `/admin/push/test`<br/>• 14건 — Haversine 지오펜스<br/>• 그 외 모바일 다크모드 회귀 / EAS 빌드 검증 36항목<br/>**⑨ 신규 문서**<br/>• [모바일 빌드 가이드](docs/모바일-빌드-가이드.md) — CallKit 동작 검증 시나리오 + APNs 환경 분기<br/>• [푸시 운영 가이드](docs/푸시-운영-가이드.md) — 환경변수 / 헬스체크 / 트러블슈팅 / 월간 체크리스트 |
| v0.19.0 | **잔여 개선 4종 일괄 완성 — ONVIF·관리자 UI·모바일 알림·성능 최적화**<br/>v0.17.0 "Top 10 완료" 이후 제시된 4가지 개선 항목을 모두 정렬. 이제 백엔드·프론트·모바일 전 영역에서 기획 완전 구현 + 운영 편의성까지 도달.<br/>**① ONVIF PTZ 실구현 (2번)**<br/>• `onvif` npm 통합, stub → 실제 어댑터로 전환<br/>• `continuousMove` + 자동 `stop` (durationMs 기본 500ms)<br/>• `gotoPreset`, `stop(panTilt+zoom)` 지원<br/>• rtspUrl에서 호스트 추출, `ONVIF_DEFAULT_PORT` env 지원<br/>• ptzPassword AES-256-GCM 암호화 저장 (카메라 create/patch에서 자동)<br/>• 응답에서 ptzPassword 제거 (민감 정보 누출 방지)<br/>• `POST /cctv/cameras/:id/ptz/test` — ONVIF 접속 검증 엔드포인트 (관리자)<br/>**② 관리자 UI 페이지 3종 (3번)**<br/>• `/admin/users/invite` — 이메일 초대 페이지 (#4 v0.15.0 API 기반)<br/>  - 부서/직급/입사일/권한 선택 + 검증 + 만료 시간 안내<br/>• `/admin/holidays` — 공휴일 관리 + 연차 자동부여 수동 실행 (#6 v0.15.0 API)<br/>  - 연도별 목록/CRUD + JSON 일괄 등록 + 연간/월차 배치 버튼<br/>• `/admin/cameras/permissions` — 카메라 권한 관리 (#7 v0.17.0 API)<br/>  - 좌측 카메라 선택, 우측 권한 매트릭스, 공개 토글, PTZ 접속 테스트 버튼<br/>• AdminConsole 사용자 탭에 "이메일 초대" 바로가기<br/>**③ 모바일 알림 배지 + 목록 화면 (4번)**<br/>• `hooks/useNotifications.ts` — 30초 polling + WebSocket `/notifications` 실시간 구독<br/>• `app/notifications.tsx` — 목록 / 전체↔미확인 필터 / 무한 스크롤 / pull-to-refresh<br/>  - type별 이모지 아이콘 (17종) + 시각적 읽음/미확인 구분<br/>  - 탭 시 link로 이동 + 자동 읽음 처리<br/>  - "모두 읽음" 액션<br/>• 대시보드 상단 알림 종 + 미확인 배지 (99+ 표시) — 탭하면 목록으로<br/>**④ 성능 최적화 (5번)**<br/>• 메신저 `GET /unread` — for loop N+1을 **raw SQL 단일 쿼리**로 (수천 명 조직 기준 수배 개선)<br/>• 작업지시서 목록 진행률 — task별 2×count를 **groupBy 한 번**으로 (페이지당 수십 쿼리 → 1)<br/>• Prisma migration `20260423070000_perf_indexes` — 5개 복합 인덱스 신규<br/>  - `messages (room_id, created_at DESC)`<br/>  - `approval_lines (approver_id, status, document_id)`<br/>  - `task_checklists (task_id, is_completed)`<br/>  - `calendar_events (scope, start_date, end_date) WHERE is_active`<br/>  - `approval_documents (drafter_id, status, created_at DESC)`<br/>**⑤ 검증**<br/>• TypeScript 3종 모두 깨끗, **159건 전체 테스트 통과** (회귀 없음)<br/>• Prisma migration 신규 2종 적용 완료 |
| v0.18.0 | **캘린더 동기화 Phase 2 + Phase 3 완성**<br/>v0.16.0 Phase 1 ICS에 이어 **Google Calendar 양방향 연동** + **모바일 네이티브 EventKit 저장** 구현. 이제 사용자는 목적에 따라 3가지 방식을 선택할 수 있음 — **구독(지연)/양방향(실시간)/네이티브(오프라인)**.<br/>**① Phase 2 — Google Calendar OAuth 양방향**<br/>• `googleapis` 통합 + OAuth2 flow (offline access + consent + refresh token)<br/>• Prisma 신규 `CalendarExternalSync` (provider·토큰·syncToken), `CalendarEventExternalMap` (로컬↔외부 ID 매핑)<br/>• 토큰 AES-256-GCM 암호화 (mailCrypto 재사용)<br/>• `services/google-calendar.service.ts` (~400줄)<br/>  - `getAuthorizationUrl` / `handleOAuthCallback` — state에 userId로 CSRF 방어 기반<br/>  - `pushEventToGoogle` / `deleteEventOnGoogle` — 로컬 변경 → 즉시 반영, extendedProperties로 loop 방지<br/>  - `pullEventsFromGoogle` — syncToken 기반 증분 sync (410 만료 시 전체 재동기화)<br/>  - `refreshAccessTokenIfNeeded` — 만료 60초 전 자동 갱신, refresh 실패 시 비활성<br/>  - `disconnectGoogle` — Google revoke + 로컬 매핑 전체 정리<br/>• REST 5종: `GET /google/auth-url`, `GET /google/callback`, `GET /google/status`, `POST /google/sync`, `DELETE /google`<br/>• `calendar.routes.ts` 이벤트 생성/수정/삭제 시 **자동 push sync** 훅 연결<br/>• 웹 UI: `GoogleCalendarSection` — 연결 상태 + "지금 동기화" + 마지막 결과 + 해제<br/>  - OAuth 콜백 URL 파라미터(`?google=connected|error`) 자동 처리<br/>• 환경변수 미설정 시 503 우아하게 비활성화 (개발 환경 안전)<br/>**② Phase 3 — 모바일 EventKit / CalendarContract**<br/>• `expo-calendar@~14.0.6` 설치 (SDK 52 호환)<br/>• `hooks/useDeviceCalendar.ts` — 권한 요청 → 쓰기 가능 캘린더 선택 → createEventAsync<br/>• `saveEventToDevice` / `saveEventsToDevice` (알림 복수 지원)<br/>• 모바일 설정 화면에 `NativeCalendarSection` — "지금 가져오기" 버튼으로 내 일정·휴가·회의 일괄 저장<br/>  - 이벤트별 알림 분 전 자동 설정 (일정 10분, 휴가 60분, 회의 5/10분)<br/>**③ 검증**<br/>• Prisma migration `20260423060000_add_google_calendar_sync`<br/>• TypeScript 3종 모두 깨끗, **159건 전체 테스트 통과** (회귀 없음)<br/>• expo-doctor 17/17 통과<br/>**④ 환경변수 (신규)**<br/>```<br/>GOOGLE_OAUTH_CLIENT_ID=<br/>GOOGLE_OAUTH_CLIENT_SECRET=<br/>GOOGLE_OAUTH_REDIRECT_URI=  # 선택, 기본 ${PUBLIC_BASE_URL}/api/calendar-sync/google/callback<br/>```<br/>Google Cloud Console에서 OAuth 2.0 Client ID 생성 + "승인된 리디렉션 URI" 등록 필요. |
| v0.17.0 | **Top 10 갭 완료 — 디자인파일·CCTV 권한/PTZ/HLS·FCM/APNs 푸시**<br/>기획 갭 Top 10 중 남은 #5, #7, #10을 한 번에 정렬. 이로써 **10/10 (100%) 완료**.<br/>**① #5 작업지시서 디자인파일 워크플로우 (DESIGN-001~012)**<br/>• `task-orders.routes.ts`에 9개 신규 엔드포인트: 목록/업로드/새버전/다운로드/조회기록/승인/반려/버전체인/로그조회<br/>• Multer 디스크 저장 (`uploads/tasks/{id}/designs/`), AI/PSD/EPS/INDD/SKETCH/FIG 전용 MIME 추가<br/>• `TaskFileLog` 자동 기록 (upload/download/view/approve/reject) + IP/deviceType 메타<br/>• 새 버전 업로드 시 parentFileId 체인 유지, 이전 isLatest=false 처리<br/>• 업로드/승인/반려 시 작성자·업로더에게 자동 알림 (task_status_changed)<br/>• 권한: 작성자/배정자/관리자만 조회·업로드·다운, 승인·반려는 작성자 본인만<br/>**② #7 CCTV 권한 + PTZ + HLS 스트림 프레임워크**<br/>• Prisma `CameraPermission` 신규 모델 + enum (subjectType: user/department/role, level: view/control)<br/>• Camera에 `isPublic`, `ptzAdapter`, `ptzUsername/Password` 필드 추가<br/>• `services/cctv-permission.service.ts` — `getCameraAccessLevel` / `listAllowedCameraIds` (관리자 우회, 공개 카메라, 명시 권한 통합)<br/>• 기존 CCTV 엔드포인트(`GET /cameras`, `/recordings`) 권한 필터 적용<br/>• 신규 권한 관리 API 3종: `GET/POST /cameras/:id/permissions`, `DELETE /:permId`<br/>• PTZ 제어: `services/cctv-ptz.service.ts` — 어댑터 패턴 (stub/onvif) + `POST /cameras/:id/ptz` (control 권한 필요)<br/>• 실시간 스트림: `services/cctv-stream.service.ts` — FFmpeg child_process 래퍼<br/>  - `POST /cameras/:id/stream/start` (RTSP→HLS 변환 시작, viewer 추가)<br/>  - `POST /stream/stop` (viewer 감소) / `GET /stream/playlist.m3u8 \| segN.ts` (HLS 서빙)<br/>  - 5분 idle 자동 종료, 카메라당 20명 제한, 디렉토리 탈출 방어<br/>  - `CCTV_FFMPEG_PATH` 미설정 시 501 응답 (개발/테스트 안전)<br/>  - shutdown hook으로 모든 ffmpeg 프로세스 SIGTERM<br/>**③ #10 FCM/APNs 푸시 알림 (Expo 기반)**<br/>• `expo-server-sdk` 설치 + `services/push.service.ts`<br/>  - `sendPushToUser` / `sendPushToTokens` (chunk 처리, DeviceNotRegistered 시 토큰 자동 비활성)<br/>  - `registerPushToken` / `unregisterPushToken` (upsert)<br/>• `notification.service.ts`의 `createNotification`에 **push 발송 훅** 추가 → 모든 알림이 자동으로 모바일 FCM/APNs 푸시로 전달<br/>• 신규 API: `POST /notifications/devices` (Expo 토큰 검증), `DELETE /notifications/devices/:deviceId`<br/>• `DISABLE_PUSH=true` env로 테스트/CI 환경 안전<br/>• 모바일: `usePushNotifications` 훅 신규 — 권한 요청 + 토큰 획득 + Android 채널 + 백엔드 등록<br/>• `_layout.tsx`에서 자동 호출 (로그인 상태 되면 1회)<br/>**④ 검증**<br/>• Prisma migration 신규 (camera_permissions + camera 필드)<br/>• TypeScript 3종 (backend/web/mobile) 모두 깨끗<br/>• **159건 전체 테스트 통과** (기존 동일, 회귀 없음)<br/>**⑤ 기획 갭 Top 10 달성률**<br/>• v0.14.0: #1/#2/#3 (3개)<br/>• v0.15.0: #4/#6/#8/#9 (4개) + 캘린더 동기화 기획 신규<br/>• v0.16.0: 캘린더 동기화 Phase 1 ICS 구현<br/>• **v0.17.0: #5/#7/#10 (3개) → 백엔드 코어 10/10 완료 🎉** |
| v0.16.0 | **캘린더 외부 동기화 Phase 1 — ICS 구독 URL**<br/>기획 문서(v0.15.0)의 Phase 1을 실제 구현. iPhone/Android/Google/Outlook에서 Project Office 일정을 구독하여 **OS 자체 알림** 활용.<br/>• Prisma `CalendarSubscription` 모델 + migration — 토큰·scope·reminderMinutes·활성상태·접근로그<br/>• `services/calendar-sync.service.ts` — CRUD + `ical-generator`로 RFC 5545 iCalendar 렌더링<br/>  - CalendarEvent / Vacation / Meeting / TaskOrder 4종 통합<br/>  - VALARM 블록(OS 알림 자동 등록) per 이벤트 × 복수 알림시간<br/>  - scope 필터 (personal / personal_dept / all)<br/>  - 과거 30일 + 미래 365일 범위 제한 (성능)<br/>• `routes/calendar-sync.routes.ts`<br/>  - JWT: POST/GET/PATCH/DELETE + POST regenerate (토큰 회전)<br/>  - 공개 feed: `GET /feed/:token.ics` — 5분 60회 rate limit, ETag/304 지원<br/>  - 응답에 `feedUrl.https` + `feedUrl.webcal` 둘 다 제공 (iOS deep link)<br/>• 웹 UI `pages/CalendarSync.tsx` — 설정 페이지, 구독 생성 모달, URL 복사, webcal 열기, 회전/삭제<br/>• 모바일 화면 `app/settings/calendar-sync.tsx` — Alert 기반 UX, `Linking.openURL('webcal://...')`로 iOS 캘린더 자동 연동<br/>• 신규 테스트 16건 (CRUD + find + ICS 렌더 + scope 필터) → 전체 **143 → 159건 통과**<br/>• TypeScript 3종 모두 깨끗 |
| v0.15.0 | **백엔드 코어 정렬 2차 — 법정 연차·초대 플로우·메신저 CRUD·문서 버전관리**<br/>**① 연차 자동부여 + 공휴일 시스템 (#6)**<br/>• Prisma `Holiday` 모델 + enum `HolidayType` (법정/대체/회사/기념일)<br/>• User 모델에 `hireDate` 추가 (근속년수 계산 기준)<br/>• VacationBalance에 tenureYears/grantedAt 추적 필드<br/>• `vacation-accrual.service.ts` — 근로기준법 §60 기반<br/>  - 1~2년차 15일, 이후 2년마다 +1일, 21년+ 25일 상한<br/>  - 근속 1년 미만은 월차 +1일 (최대 11일)<br/>  - 멱등 upsert (usedDays 보존)<br/>• `workers/vacationAccrual.worker.ts` — node-cron<br/>  - 매년 1/1 01:00 KST 연간 부여 배치<br/>  - 매월 1일 01:30 KST 월차 부여 배치<br/>• `routes/holiday.routes.ts` — 공휴일 CRUD + bulk-import + 수동 배치 실행 (관리자)<br/>• `countWorkdays()` — 주말 + 공휴일 제외 근무일수 계산 (휴가 일수 정확 산정 기반)<br/>**② 사용자 초대 + 비밀번호 재설정 (#4)**<br/>• Prisma `AuthToken` 모델 + enum `AuthTokenType` (invite / password_reset)<br/>• `services/system-mail.service.ts` — nodemailer 기반 SMTP 발송, 한글 HTML 템플릿<br/>  - `SYSTEM_MAIL_SMTP_HOST` 미설정 시 로그만 찍고 개발 모드 유지<br/>• `services/auth-token.service.ts` — 32B random token, 만료(초대 48h / 재설정 1h) + 단일 사용<br/>• `POST /auth/invite` (관리자) → 사번·이름·role·부서 등 메타 지정해서 이메일 발송<br/>• `GET /auth/invite/:token` 검증 / `POST /auth/invite/:token/accept` 비번 설정<br/>• `POST /auth/forgot-password` (존재 누출 방지) / `GET /auth/reset-password/:token` 검증 / `POST` 재설정<br/>• 재설정 시 비번 히스토리 검사 + 모든 리프레시 토큰 revoke (전역 로그아웃)<br/>**③ 메신저 메시지 수정/삭제 (#8, SEND-008/009)**<br/>• `PATCH /messenger/rooms/:roomId/messages/:msgId` — 1시간 이내 텍스트만<br/>• `DELETE` — 24시간 이내 (관리자는 무제한), soft delete<br/>• WebSocket `/messenger` 네임스페이스로 `message:edited` / `message:deleted` 실시간 브로드캐스트<br/>**④ 문서관리 실제 업로드 + 버전관리 (#9, DOC-006/VER-001~005)**<br/>• Prisma `DocumentVersion` 신규 모델 (버전 이력 테이블)<br/>• `POST /document/upload` — Multer 디스크 저장, 확장자+MIME 교차검증<br/>• `POST /files/:id/upload-version` — 새 버전 업로드 (기존 파일 DocumentVersion으로 이관)<br/>• `GET /files/:id/file` — 현재 버전 다운로드 (디렉토리 탈출 방어)<br/>• `GET /files/:id/versions` — 버전 이력 / `GET /files/:id/versions/:ver/file` — 과거 버전 다운로드<br/>**⑤ 캘린더 외부 동기화 기획 문서 신규** (`docs/기능명세/11-캘린더-외부-동기화.md`)<br/>• Phase 1 ICS 구독 URL / Phase 2 Google Calendar OAuth / Phase 3 EventKit 단계적 로드맵<br/>• 의사결정 5개 포인트 + 보안·데이터모델·API 설계 포함<br/>• VALARM 기반 OS 알림 활용으로 FCM/APNs 없이도 알림 구현 가능 명시<br/>**⑥ 검증**<br/>• Prisma migration 3종 (holidays+hireDate / auth_tokens+doc_versions)<br/>• 신규 단위 테스트 10건 (연차 계산 로직) → **133 → 143건 통과**<br/>• TypeScript 3종 (backend/web/mobile) 모두 깨끗 |
| v0.14.0 | **백엔드 코어 정렬 — 통합 알림 + 휴가↔결재↔캘린더 통합 + 결재 첨부파일**<br/>• 기획 문서 전수 검토 후 "모델만 있고 API 없는 반쪽짜리" 패턴 확인 → 횡단 관심사부터 정렬<br/>**① 통합 알림 시스템**<br/>• 신규 `Notification` 모델 + enum `NotificationType` (17종: 결재·휴가·메신저·게시판·작업·회의·메일·시스템)<br/>• `services/notification.service.ts` — `createNotification`/`Bulk`/`markAsRead`/`markAllAsRead`/`countUnread`/`deleteByRef`<br/>• WebSocket `/notifications` 네임스페이스 — `notification:new` 실시간 push + `notification:unread` 카운트 동기<br/>• REST `GET /notifications`, `/unread-count`, `PATCH /:id/read`, `POST /mark-all-read`<br/>**② 휴가 ↔ 전자결재 ↔ 캘린더 통합** (기획 §12 이중 워크플로우 해소)<br/>• `services/vacation-approval.service.ts` 신규 — 단일 트랜잭션에서 `Vacation` + `ApprovalDocument` + 결재선 함께 생성, 양방향 링크<br/>• 결재 최종 승인 시 콜백 → `Vacation.status=approved` + `VacationBalance` 차감 + `CalendarEvent` 자동등록<br/>• 결재 반려 시 콜백 → `Vacation.status=rejected` + `rejectionReason` 저장<br/>• `POST /attendance/vacations`를 결재 연동 API로 재구성 (`approverIds` 필수)<br/>• 문서번호 채번에 `pg_advisory_xact_lock` + Unique 위반 5회 retry — 동시 휴가 신청 경쟁 안전<br/>• `approval.service` `submitDocument`/`approve`/`reject`에 알림 훅 — 첫 결재자/다음 결재자/기안자/참조자에게 자동 알림<br/>**③ 결재 첨부파일 API** (APR-005, 모델만 있던 엔드포인트 완성)<br/>• `POST /approvals/documents/:id/attachments` (Multer, 5개/20MB/확장자+MIME 교차검증)<br/>• `GET` 목록 / `GET /:attId/file` 다운로드 / `DELETE`<br/>• 기안자만 업로드·삭제, `canAccessAttachment` 권한 검증<br/>• AuditAction enum에 `approval_attachment_upload/delete` 추가<br/>**④ 검증**<br/>• Prisma migration 3종 (notifications / audit actions / attachment)<br/>• 신규 테스트 15건 (알림 7 + 휴가통합 8) → 전체 **118 → 133건 통과**<br/>• TypeScript 3종 (backend/web/mobile) 모두 깨끗 |
| v0.13.0 | **AI 자동 회의록 생성 (Phase 2 완성)**<br/>• Prisma 신규 모델 `MeetingTranscript` / `MeetingMinutes` + enum `MeetingMinutesStatus`(generating/draft/final/failed) migration<br/>• WebSocket `meeting:transcript` 이벤트에서 `isFinal=true` 발언만 DB 영속화 (speaker·text·timestamp)<br/>• `@anthropic-ai/sdk` 통합 — `services/minutes.service.ts` (~260줄)<br/>  - Claude Sonnet 4.5로 전사 전체를 구조화 JSON(summary/topics/decisions/actionItems)으로 변환<br/>  - 회의 종료(`POST /:id/end`) 시 비동기 트리거, 결과는 GET 폴링<br/>  - 코드펜스·설명문 제거, 파싱 실패 시 원문 fallback — 견고한 JSON 파서<br/>• 회의록 REST 5종 신규 — GET/PATCH/finalize/regenerate/transcripts<br/>  - 편집/확정은 호스트·관리자만, final 상태는 편집 거부, 관리자는 force=true로 재생성<br/>• 웹 신규 `/meeting/:id/minutes` 페이지 (~500줄)<br/>  - 상태 배지 + 3초 폴링(generating) / 인라인 편집(draft) / 잠금(final) / 실패 메시지<br/>  - 요약 / 주제 / 결정사항 / 액션아이템 4섹션 조회·편집 UI<br/>  - 원문 발언 기록 펼침 + 브라우저 인쇄(PDF)<br/>• 회의 목록에서 종료된 회의 상세 → "AI 회의록 열람" 진입 버튼<br/>• `config.anthropic.enabled` — API 키 없으면 failed 상태로 우아하게 기록, 로컬/테스트 환경 깨지지 않음<br/>• 신규 테스트 15건 (9 단위 JSON 파서 + 6 통합) → 전체 **103 → 118건 통과** |
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
- [모바일 빌드 가이드](docs/모바일-빌드-가이드.md) — EAS dev/preview/production + CallKit 검증
- [푸시 운영 가이드](docs/푸시-운영-가이드.md) — Expo Push 환경변수 + 헬스체크 + 트러블슈팅
- [릴리스 검증 체크리스트](docs/release-verification.md)
- [기능명세서](docs/기능명세/) (12개 문서 — 모바일 v1.0 기획 포함)

## 라이선스

Private - KSCorp
