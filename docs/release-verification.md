# 릴리스 검증 체크리스트

작업 릴리스(v0.14.0 ~ v0.19.0)의 정상 작동을 **최단 경로**로 확인하기 위한 체크리스트.
자동 검증 가능한 것은 `scripts/verify-all.sh`로, 외부 서비스 의존은 이 문서의 수동 항목으로 나눈다.

## 1. 자동 검증 (필수, 5분 이내)

```bash
./scripts/verify-all.sh
# 또는 테스트 제외:
./scripts/verify-all.sh --skip-tests
```

통과 항목:
- Node 20+, 의존성 설치, 버전 일관성
- TypeScript 3종 (backend/web/mobile) 타입체크
- Backend Vitest 159건
- Prisma migration 상태
- 필수 환경변수 설정
- Backend 빌드

**✗ 실패가 하나라도 있으면 이 아래 수동 항목으로 넘어가지 않는다.**

---

## 2. 외부 서비스 의존 기능 (수동, ~20분)

각 항목은 **환경변수 설정 + UI 실제 동작 확인**으로 이중 검증.

### 2.1 메일 수신 (AWS WorkMail)

**환경변수**
- `apps/backend/.env` 에 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `WORKMAIL_ORG_ID` 설정

**UI 검증**
1. 관리자 계정 로그인
2. `/admin/mail/test` 진입
3. 활성 계정 각각에 대해 **"수신 테스트"** 클릭
4. ✅ 접속 성공 + INBOX 메일 카운트 표시
5. 최근 메일 5통이 테이블에 나타남 (보낸이/제목/수신시각)

**실패 시 확인**
- `apps/backend/.env`의 AWS 자격증명
- WorkMail 계정의 IMAP 활성화 상태 (일부 국가는 기본 비활성)
- 관리자 콘솔 → 감사 로그에 `receive_test` 기록 남았는지

---

### 2.2 AI 회의록 생성 (Anthropic Claude)

**환경변수**
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5  # 선택
```

**검증 절차**
1. 회의 1개 생성 → 시작 → (테스트용으로 `meeting:transcript` 발언 수동 저장 가능)
2. 회의 종료 (`POST /meeting/:id/end`)
3. `/meeting/:id/minutes` 진입 → 3초 폴링
4. `generating` → `draft` 상태 전환 확인 (약 10~30초)
5. 요약/주제/결정사항/액션 4섹션 렌더링

**키 미설정 상태 검증**
- 회의록 상태가 `failed` + `ANTHROPIC_API_KEY 미설정` 메시지 표시
- 서버가 죽지 않음

---

### 2.3 이메일 발송 (시스템 SMTP — 초대/비번 재설정)

**환경변수**
```bash
SYSTEM_MAIL_SMTP_HOST=smtp.gmail.com
SYSTEM_MAIL_SMTP_PORT=465
SYSTEM_MAIL_USER=...
SYSTEM_MAIL_PASS=...
SYSTEM_MAIL_FROM=Project Office <no-reply@ks-corporation.co.kr>
WEB_URL=https://...
```

**UI 검증**
1. `/admin/users/invite` 접속
2. 테스트 이메일 (본인 것) 입력 + 다른 필드 채우기 + "초대 메일 발송"
3. ✅ "초대 메일이 발송되었습니다" + 만료 시간
4. 실제 수신함 확인 → 버튼/링크 동작
5. `/reset-password` 플로우도 `POST /auth/forgot-password`로 유사하게

**미설정 시**: 콘솔에 `[system-mail] email skipped` 로그만, 201 응답은 정상

---

### 2.4 푸시 알림 (Expo / FCM+APNs)

**환경변수**
```bash
EXPO_ACCESS_TOKEN=...  # 선택, 없어도 발송 가능하나 rate limit 엄격
```

**검증**
1. EAS Dev Client 빌드된 실기기로 앱 로그인 (모바일)
2. 대시보드 우측 알림 종 표시 확인 (초기 0)
3. **다른 사용자 계정**으로 현 사용자에게 메시지 전송 / 결재 요청
4. ✅ 모바일에 푸시 알림 + 배지 업데이트
5. 알림 탭 → `/notifications` 화면 → 해당 알림 있음

**Expo Go 환경**: 푸시 토큰 획득 제한적 (실기기 Dev Client 권장)

---

### 2.5 Google Calendar 양방향 (OAuth)

**환경변수**
```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://<host>/api/calendar-sync/google/callback
```

Google Cloud Console에서 OAuth 2.0 Client ID 생성 + "승인된 리디렉션 URI" 등록 필수.

**UI 검증**
1. 웹 로그인 → `/settings/calendar-sync`
2. "Google 계정으로 연동" 클릭 → Google 동의 화면
3. 권한 승인 → 리다이렉트 → `?google=connected` 배너
4. "지금 동기화" 클릭 → imported/updated/deleted 카운트 표시
5. Google Calendar에서 해당 계정 → Project Office가 생성한 이벤트 확인 (있다면)
6. Google에서 이벤트 1개 수동 생성 → "지금 동기화" → 로컬 캘린더에 반영 확인

**미설정 시**: "서버에 Google OAuth가 설정되지 않았습니다" 메시지 (503)

---

### 2.6 CCTV 실시간 스트림 + PTZ (FFmpeg + ONVIF)

**환경변수**
```bash
CCTV_FFMPEG_PATH=/usr/local/bin/ffmpeg
CCTV_PTZ_DEFAULT_ADAPTER=onvif  # 실기기 시
ONVIF_DEFAULT_PORT=80
```

**검증 — 실시간 스트림**
1. 관리자 → `/admin` → CCTV 모듈 활성화
2. `/admin/cameras/permissions` → 카메라 1개 선택 → "공개" 토글
3. `/cctv` 접속 → 해당 카메라 클릭 → HLS 스트림 로드
4. ✅ 5~10초 내 영상 재생
5. 마지막 사용자 이탈 후 5분 → 서버 로그에 `idle timeout — stopping`

**검증 — PTZ (실제 ONVIF 카메라)**
1. `/admin/cameras/permissions` → PTZ 카메라 선택
2. "PTZ 접속 테스트" 클릭 → ✅ 접속 성공
3. `/cctv`에서 카메라 화면에서 방향 버튼 클릭 → 실제로 움직임

**미설정 시**: `POST /stream/start` 가 501 반환 (FFmpeg 없음) — 서버는 정상

---

### 2.7 캘린더 ICS 구독 + 모바일 네이티브 (이미 v0.16.0/v0.18.0)

1. 웹 `/settings/calendar-sync` → "새 구독 추가" → URL 복사
2. iPhone 설정 → 캘린더 → 계정 추가 → 기타 → "구독 캘린더 추가" → URL 붙여넣기
3. ✅ iPhone 캘린더에 Project Office 일정 표시
4. 모바일 앱 → "외부 캘린더 연동" → "지금 가져오기" (EventKit) → ✅ 기기 캘린더에 저장

---

### 2.8 실시간 알림 (WebSocket `/notifications`)

1. 웹 + 모바일 동시 로그인 (동일 계정)
2. 다른 사용자가 결재 요청 보냄
3. ✅ 웹 우측 알림 아이콘 배지 즉시 증가
4. ✅ 모바일 대시보드 알림 종 배지 동시 증가
5. 알림 클릭 → 해당 페이지로 이동

---

## 3. 비즈니스 흐름 통합 검증 (중요 경로, ~10분)

### 3.1 휴가 ↔ 결재 ↔ 캘린더 ↔ 연차 통합

1. 일반 사용자 로그인
2. `POST /attendance/vacations`로 휴가 신청 (approverIds 지정)
3. ✅ Vacation + ApprovalDocument 둘 다 생성 확인 (DB)
4. ✅ 첫 결재자에게 알림 + 모바일 푸시
5. 결재자가 승인 → ✅ Vacation.status=approved
6. ✅ VacationBalance.remainDays 차감 (annual/half만)
7. ✅ CalendarEvent 자동 생성 (allDay, 개인)
8. ✅ 기안자에게 approval_approved 알림

**반려 시**: VacationBalance 변경 없음, CalendarEvent 없음, rejection 알림

---

### 3.2 결재 첨부파일

1. 결재 문서 draft 생성
2. `POST /approvals/documents/:id/attachments` (Multer 업로드)
3. ✅ 5개 제한 / 20MB 제한 / MIME 교차검증 동작
4. GET 목록/다운로드 동작
5. 완료(approved) 후 업로드 시 INVALID_STATUS

---

### 3.3 디자인파일 워크플로우

1. 작업지시서 생성 → 디자인파일 업로드 (AI/PSD 등)
2. 다운로드 → ✅ TaskFileLog에 `download` 기록
3. "승인" → ✅ `approve` 로그 + 업로더에게 알림
4. 새 버전 업로드 → ✅ parentFileId 체인 + isLatest 자동 토글
5. GET `/versions` → 체인 전체 반환

---

## 4. 프로덕션 배포 직전 체크

- [ ] `apps/backend/.env` 에 **모든** 프로덕션 시크릿 세팅 (localhost 값 아님)
- [ ] `PUBLIC_BASE_URL`, `CORS_ORIGIN`, `WEB_URL` 도메인 일치
- [ ] `JWT_ACCESS_SECRET`/`REFRESH_SECRET` 32자 이상, 서로 다름
- [ ] `MAIL_ENCRYPTION_KEY` 64 hex chars (32바이트) — 암호화 키 유실 시 메일 접근 불가
- [ ] `docker-compose.yml` 포트 바인딩 `127.0.0.1:*` (외부 노출 차단)
- [ ] `nginx` HTTPS + HSTS + 보안 헤더
- [ ] PostgreSQL 백업 cron (매일 02:00 UTC)
- [ ] `scripts/deploy.sh status` 한 번 실행해서 실제 컨테이너 가동
- [ ] Health check URL 반환 200 (`GET /health`)
- [ ] 감사 로그 쿼리로 테스트 트래픽 필터링되는지

---

## 5. Staging 환경에서 먼저 검증

프로덕션 배포 전 `scripts/staging.sh` 로 스테이징 기동:

```bash
./scripts/staging.sh start   # compose up -d (staging 포트로)
./scripts/staging.sh status  # 컨테이너 + health check
./scripts/staging.sh logs    # 실시간 로그
./scripts/staging.sh stop    # 중지
```

Staging이 정상 작동하면 위 체크리스트를 staging 환경에서 한 번 더 반복 후 프로덕션 배포.

---

## 6. 실패 시 복구

| 증상 | 점검 순서 |
|------|-----------|
| Backend 기동 실패 | `config.ts`의 `requireEnv` 에러 메시지 → 해당 env 누락 → `.env` 수정 |
| Migration 오류 | `npx prisma migrate status` → 실패 migration `resolve --rolled-back` → 다시 적용 |
| 메일 접속 실패 | `/admin/mail/test` → 에러 메시지 확인 → IMAP 자격증명 / IMAP 활성 상태 |
| 알림 안 옴 | WebSocket 연결 확인 (`/notifications` 네임스페이스) → 로그인 JWT 유효 |
| PTZ 실패 | `POST /cameras/:id/ptz/test` → onvif 패키지 설치 / 카메라 IP/비번 |
| 회의록 안 생성 | `/meeting/:id/minutes` 상태 = failed → errorMessage 확인 (API 키 vs 전사 0건) |
