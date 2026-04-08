# API 설계서

## 1. 공통 규칙

### 1.1 Base URL
```
Production: https://api.projectoffice.com/v1
Development: http://localhost:3000/api/v1
```

### 1.2 인증
모든 API(로그인/회원가입 제외)는 Authorization 헤더 필요:
```
Authorization: Bearer {access_token}
```

### 1.3 응답 형식
```json
// 성공
{
  "success": true,
  "data": { ... },
  "message": "요청 성공"
}

// 실패
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "이메일 형식이 올바르지 않습니다"
  }
}

// 페이지네이션
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### 1.4 HTTP 상태 코드
| 코드 | 의미 |
|------|------|
| 200 | 성공 |
| 201 | 생성 성공 |
| 400 | 잘못된 요청 |
| 401 | 인증 실패 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (중복) |
| 422 | 유효성 검사 실패 |
| 429 | 요청 제한 초과 |
| 500 | 서버 오류 |

### 1.5 기능 모듈 미들웨어
비활성화된 모듈의 API 호출 시:
```json
{
  "success": false,
  "error": {
    "code": "MODULE_DISABLED",
    "message": "해당 기능이 비활성화되어 있습니다"
  }
}
```

---

## 2. 인증 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | /auth/login | 로그인 | Public |
| POST | /auth/logout | 로그아웃 | Auth |
| POST | /auth/refresh | 토큰 갱신 | Public |
| POST | /auth/forgot-password | 비밀번호 찾기 | Public |
| POST | /auth/reset-password | 비밀번호 재설정 | Public |
| PUT | /auth/change-password | 비밀번호 변경 | Auth |
| POST | /auth/invite/accept | 초대 수락 (계정 활성화) | Public |

---

## 3. 사용자 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /users/me | 내 프로필 조회 | Auth |
| PUT | /users/me | 내 프로필 수정 | Auth |
| PUT | /users/me/avatar | 프로필 이미지 변경 | Auth |
| GET | /users | 사용자 목록 | Auth |
| GET | /users/:id | 사용자 상세 | Auth |
| POST | /users/invite | 사용자 초대 | Admin |
| PUT | /users/:id | 사용자 정보 수정 | Admin |
| DELETE | /users/:id | 사용자 삭제 | Admin |
| PUT | /users/:id/status | 사용자 상태 변경 | Admin |
| PUT | /users/:id/role | 사용자 역할 변경 | Admin |
| POST | /users/:id/reset-password | 비밀번호 초기화 | Admin |
| GET | /users/:id/login-history | 로그인 이력 | Admin |

---

## 4. 조직 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /departments | 부서 목록 (트리) | Auth |
| GET | /departments/:id | 부서 상세 | Auth |
| GET | /departments/:id/members | 부서원 목록 | Auth |
| POST | /departments | 부서 생성 | Admin |
| PUT | /departments/:id | 부서 수정 | Admin |
| DELETE | /departments/:id | 부서 삭제 | Admin |
| PUT | /departments/:id/sort | 부서 정렬 변경 | Admin |
| PUT | /departments/:id/leader | 부서장 지정 | Admin |
| POST | /departments/:id/members | 부서원 추가 | Admin |
| DELETE | /departments/:id/members/:userId | 부서원 제거 | Admin |

---

## 5. 전자결재 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /approval/templates | 결재 양식 목록 | Auth |
| GET | /approval/templates/:id | 결재 양식 상세 | Auth |
| POST | /approval/templates | 결재 양식 생성 | Admin |
| PUT | /approval/templates/:id | 결재 양식 수정 | Admin |
| DELETE | /approval/templates/:id | 결재 양식 삭제 | Admin |
| | | | |
| GET | /approval/documents | 결재 문서 목록 (문서함별) | Auth |
| GET | /approval/documents/:id | 결재 문서 상세 | Auth |
| POST | /approval/documents | 결재 문서 작성 | Auth |
| PUT | /approval/documents/:id | 결재 문서 수정 (임시저장) | Auth |
| POST | /approval/documents/:id/submit | 결재 상신 | Auth |
| POST | /approval/documents/:id/withdraw | 결재 회수 | Auth |
| DELETE | /approval/documents/:id | 결재 문서 삭제 (임시저장만) | Auth |
| | | | |
| POST | /approval/documents/:id/approve | 결재 승인 | Auth |
| POST | /approval/documents/:id/reject | 결재 반려 | Auth |
| POST | /approval/documents/:id/hold | 결재 보류 | Auth |
| POST | /approval/documents/:id/remind | 결재 독촉 | Auth |
| GET | /approval/documents/:id/timeline | 결재 진행 타임라인 | Auth |
| | | | |
| GET | /approval/saved-lines | 저장된 결재선 목록 | Auth |
| POST | /approval/saved-lines | 결재선 저장 | Auth |
| DELETE | /approval/saved-lines/:id | 결재선 삭제 | Auth |
| | | | |
| GET | /approval/delegations | 위임 목록 | Auth |
| POST | /approval/delegations | 위임 설정 | Auth |
| DELETE | /approval/delegations/:id | 위임 해제 | Auth |
| | | | |
| GET | /approval/stats | 결재 현황 통계 | Auth |

---

## 6. 메신저 API

### 6.1 REST API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /messenger/rooms | 채팅방 목록 | Auth |
| GET | /messenger/rooms/:id | 채팅방 상세 | Auth |
| POST | /messenger/rooms | 채팅방 생성 | Auth |
| PUT | /messenger/rooms/:id | 채팅방 수정 (이름) | Auth |
| POST | /messenger/rooms/:id/members | 멤버 초대 | Auth |
| DELETE | /messenger/rooms/:id/leave | 채팅방 나가기 | Auth |
| PUT | /messenger/rooms/:id/pin | 채팅방 고정/해제 | Auth |
| PUT | /messenger/rooms/:id/notification | 알림 설정 | Auth |
| | | | |
| GET | /messenger/rooms/:id/messages | 메시지 목록 (페이지네이션) | Auth |
| GET | /messenger/rooms/:id/messages/search | 메시지 검색 | Auth |
| PUT | /messenger/messages/:id | 메시지 수정 | Auth |
| DELETE | /messenger/messages/:id | 메시지 삭제 | Auth |
| POST | /messenger/rooms/:id/notice | 공지 설정 | Auth |
| DELETE | /messenger/rooms/:id/notice | 공지 해제 | Auth |
| | | | |
| GET | /messenger/rooms/:id/files | 공유 파일 목록 | Auth |
| GET | /messenger/rooms/:id/images | 공유 이미지 목록 | Auth |
| GET | /messenger/unread-count | 전체 안읽은 수 | Auth |

### 6.2 WebSocket 이벤트 (Socket.IO - /messenger)

**클라이언트 → 서버:**
| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| join_room | {roomId} | 채팅방 입장 |
| leave_room | {roomId} | 채팅방 퇴장 |
| send_message | {roomId, type, content, tempId, parentId?} | 메시지 전송 |
| typing | {roomId, isTyping} | 타이핑 상태 |
| read_messages | {roomId, messageId} | 읽음 처리 |

**서버 → 클라이언트:**
| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| message_received | {message} | 새 메시지 |
| message_ack | {tempId, messageId} | 전송 확인 |
| message_updated | {messageId, content} | 메시지 수정됨 |
| message_deleted | {messageId} | 메시지 삭제됨 |
| user_typing | {roomId, userId, isTyping} | 타이핑 표시 |
| read_update | {roomId, userId, messageId} | 읽음 업데이트 |
| member_joined | {roomId, user} | 멤버 입장 |
| member_left | {roomId, userId} | 멤버 퇴장 |

---

## 7. CCTV API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /cctv/cameras | 카메라 목록 (접근 가능) | Auth |
| GET | /cctv/cameras/:id | 카메라 상세 | Auth |
| POST | /cctv/cameras | 카메라 등록 | Admin |
| PUT | /cctv/cameras/:id | 카메라 수정 | Admin |
| DELETE | /cctv/cameras/:id | 카메라 삭제 | Admin |
| GET | /cctv/cameras/:id/stream | 스트리밍 URL 조회 | Auth |
| POST | /cctv/cameras/:id/snapshot | 스냅샷 캡처 | Auth |
| | | | |
| GET | /cctv/cameras/:id/recordings | 녹화 목록 | Auth |
| GET | /cctv/recordings/:id/play | 녹화 재생 URL | Auth |
| | | | |
| POST | /cctv/cameras/:id/ptz | PTZ 제어 | Auth |
| POST | /cctv/cameras/:id/ptz/lock | PTZ Lock 획득 | Auth |
| DELETE | /cctv/cameras/:id/ptz/lock | PTZ Lock 해제 | Auth |
| | | | |
| GET | /cctv/cameras/:id/access | 접근 권한 조회 | Admin |
| PUT | /cctv/cameras/:id/access | 접근 권한 설정 | Admin |
| GET | /cctv/groups | 카메라 그룹 목록 | Auth |

---

## 8. 근태관리 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | /attendance/check-in | 출근 체크 | Auth |
| POST | /attendance/check-out | 퇴근 체크 | Auth |
| GET | /attendance/today | 오늘 출퇴근 상태 | Auth |
| GET | /attendance/records | 내 근태 기록 | Auth |
| GET | /attendance/weekly | 주간 근무시간 | Auth |
| GET | /attendance/monthly | 월간 근태 요약 | Auth |
| | | | |
| GET | /attendance/department | 부서 출결 현황 | DeptAdmin |
| GET | /attendance/department/stats | 부서 근태 통계 | DeptAdmin |
| PUT | /attendance/records/:id | 근태 기록 수정 | Admin |
| | | | |
| GET | /attendance/settings | 근태 설정 조회 | Auth |
| PUT | /attendance/settings | 근태 설정 변경 | Admin |
| | | | |
| GET | /vacations | 내 휴가 목록 | Auth |
| POST | /vacations | 휴가 신청 | Auth |
| DELETE | /vacations/:id | 휴가 취소 | Auth |
| GET | /vacations/balance | 연차 잔여 조회 | Auth |
| GET | /vacations/balance/:userId | 특정 사용자 연차 조회 | Admin |
| PUT | /vacations/balance/:userId | 연차 수동 조정 | Admin |

---

## 9. 캘린더 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /calendar/events | 일정 목록 (기간) | Auth |
| GET | /calendar/events/:id | 일정 상세 | Auth |
| POST | /calendar/events | 일정 생성 | Auth |
| PUT | /calendar/events/:id | 일정 수정 | Auth |
| DELETE | /calendar/events/:id | 일정 삭제 | Auth |
| POST | /calendar/events/:id/respond | 참석 응답 | Auth |

---

## 10. 게시판 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /boards | 게시판 목록 | Auth |
| GET | /boards/:id | 게시판 상세 | Auth |
| POST | /boards | 게시판 생성 | Admin |
| PUT | /boards/:id | 게시판 수정 | Admin |
| DELETE | /boards/:id | 게시판 삭제 | Admin |
| | | | |
| GET | /boards/:id/posts | 게시글 목록 | Auth |
| GET | /posts/:id | 게시글 상세 | Auth |
| POST | /boards/:id/posts | 게시글 작성 | Auth |
| PUT | /posts/:id | 게시글 수정 | Auth |
| DELETE | /posts/:id | 게시글 삭제 | Auth |
| PUT | /posts/:id/pin | 공지 고정/해제 | Admin |
| PUT | /posts/:id/must-read | 필독 지정/해제 | Admin |
| POST | /posts/:id/read-confirm | 필독 읽음 확인 | Auth |
| GET | /posts/:id/read-status | 필독 읽음 현황 | Admin |
| | | | |
| GET | /posts/:id/comments | 댓글 목록 | Auth |
| POST | /posts/:id/comments | 댓글 작성 | Auth |
| PUT | /comments/:id | 댓글 수정 | Auth |
| DELETE | /comments/:id | 댓글 삭제 | Auth |

---

## 11. 작업명세서 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /tasks | 작업 목록 (발신/수신) | Auth |
| GET | /tasks/:id | 작업 상세 | Auth |
| POST | /tasks | 작업 생성 | Auth |
| PUT | /tasks/:id | 작업 수정 | Auth |
| POST | /tasks/:id/send | 작업 전송 | Auth |
| POST | /tasks/:id/cancel | 작업 취소 | Auth |
| | | | |
| POST | /tasks/:id/accept | 작업 수락 | Auth |
| POST | /tasks/:id/reject | 작업 거절 | Auth |
| PUT | /tasks/:id/status | 상태 변경 | Auth |
| POST | /tasks/:id/report | 완료 보고 | Auth |
| POST | /tasks/:id/approve-report | 보고 승인 | Auth |
| POST | /tasks/:id/reject-report | 보고 반려 | Auth |
| POST | /tasks/:id/remind | 독촉 알림 | Auth |
| | | | |
| GET | /tasks/:id/checklist | 체크리스트 | Auth |
| POST | /tasks/:id/checklist | 항목 추가 | Auth |
| PUT | /tasks/checklist/:id | 항목 수정/체크 | Auth |
| DELETE | /tasks/checklist/:id | 항목 삭제 | Auth |
| | | | |
| GET | /tasks/:id/comments | 코멘트 목록 | Auth |
| POST | /tasks/:id/comments | 코멘트 추가 | Auth |
| | | | |
| GET | /tasks/stats | 작업 통계 | Auth |
| GET | /tasks/stats/department | 부서별 통계 | DeptAdmin |

---

## 12. 재고관리 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /inventory/categories | 카테고리 목록 | Auth |
| POST | /inventory/categories | 카테고리 생성 | Admin |
| PUT | /inventory/categories/:id | 카테고리 수정 | Admin |
| DELETE | /inventory/categories/:id | 카테고리 삭제 | Admin |
| | | | |
| GET | /inventory/items | 품목 목록 | Auth |
| GET | /inventory/items/:id | 품목 상세 | Auth |
| POST | /inventory/items | 품목 등록 | Auth |
| PUT | /inventory/items/:id | 품목 수정 | Auth |
| DELETE | /inventory/items/:id | 품목 삭제 | Admin |
| | | | |
| POST | /inventory/transactions | 입출고 등록 | Auth |
| GET | /inventory/transactions | 입출고 이력 | Auth |
| GET | /inventory/items/:id/transactions | 품목별 입출고 이력 | Auth |
| | | | |
| POST | /inventory/audits | 재고 실사 등록 | Admin |
| GET | /inventory/audits | 실사 이력 | Admin |
| | | | |
| GET | /inventory/stats/overview | 재고 요약 | Auth |
| GET | /inventory/stats/trend | 입출고 추이 | Auth |
| GET | /inventory/stats/category | 카테고리별 분포 | Auth |
| GET | /inventory/stats/department | 부서별 출고 | Auth |
| GET | /inventory/stats/top-items | 다소비 품목 | Auth |
| GET | /inventory/stats/shortage | 안전재고 미달 | Auth |

---

## 13. 화상회의 API

### 13.1 REST API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | /meetings | 회의 생성 (즉석/예약) | Auth |
| GET | /meetings | 회의 목록 | Auth |
| GET | /meetings/:id | 회의 상세 | Auth |
| PUT | /meetings/:id | 회의 수정 (예약) | Auth |
| DELETE | /meetings/:id | 회의 취소 | Auth |
| POST | /meetings/:id/join | 회의 참여 | Auth |
| POST | /meetings/:id/end | 회의 종료 | Auth (Host) |
| | | | |
| GET | /meetings/:id/minutes | 회의록 조회 | Auth |
| PUT | /meetings/:id/minutes | 회의록 수정 | Auth |
| POST | /meetings/:id/minutes/confirm | 회의록 확정 | Auth (Host) |
| GET | /meetings/:id/transcript | 발언 기록 | Auth |
| GET | /meetings/:id/recording | 녹화 재생 | Auth |
| | | | |
| GET | /meetings/search | 회의 검색 (상위 직급) | Auth |
| GET | /meetings/stats | 회의 통계 | Auth |

### 13.2 WebSocket 이벤트 (Socket.IO - /meeting)

**시그널링:**
| 이벤트 | 방향 | 설명 |
|--------|------|------|
| join_meeting | C→S | 회의 입장 |
| leave_meeting | C→S | 회의 퇴장 |
| offer | C→S→C | SDP Offer |
| answer | C→S→C | SDP Answer |
| ice_candidate | C→S→C | ICE Candidate |
| toggle_video | C→S | 영상 ON/OFF |
| toggle_audio | C→S | 음성 ON/OFF |
| screen_share | C→S | 화면 공유 시작/종료 |
| raise_hand | C→S | 손들기 |
| participant_update | S→C | 참가자 상태 변경 |
| meeting_ended | S→C | 회의 종료 알림 |

---

## 14. 문서관리 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /documents/folders | 폴더 목록 | Auth |
| POST | /documents/folders | 폴더 생성 | Auth |
| PUT | /documents/folders/:id | 폴더 수정 | Auth |
| DELETE | /documents/folders/:id | 폴더 삭제 | Auth |
| | | | |
| GET | /documents/folders/:id/files | 파일 목록 | Auth |
| POST | /documents/upload | 파일 업로드 | Auth |
| GET | /documents/:id | 파일 상세 | Auth |
| GET | /documents/:id/download | 파일 다운로드 | Auth |
| GET | /documents/:id/preview | 파일 미리보기 | Auth |
| DELETE | /documents/:id | 파일 삭제 | Auth |
| PUT | /documents/:id/move | 파일 이동 | Auth |
| | | | |
| GET | /documents/:id/versions | 버전 목록 | Auth |
| GET | /documents/:id/versions/:ver | 특정 버전 다운로드 | Auth |
| | | | |
| POST | /documents/:id/share | 공유 링크 생성 | Auth |
| DELETE | /documents/shares/:id | 공유 링크 삭제 | Auth |

---

## 15. 알림 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /notifications | 알림 목록 | Auth |
| GET | /notifications/unread-count | 안읽은 알림 수 | Auth |
| PUT | /notifications/:id/read | 읽음 처리 | Auth |
| PUT | /notifications/read-all | 전체 읽음 처리 | Auth |
| DELETE | /notifications/:id | 알림 삭제 | Auth |

---

## 16. 관리자 API

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | /admin/dashboard | 관리자 대시보드 | Admin |
| GET | /admin/audit-logs | 감사 로그 | Admin |
| | | | |
| GET | /admin/modules | 기능 모듈 목록 | SuperAdmin |
| PUT | /admin/modules/:key | 모듈 ON/OFF | SuperAdmin |
| | | | |
| GET | /admin/settings | 시스템 설정 | Admin |
| PUT | /admin/settings | 시스템 설정 변경 | Admin |
| GET | /admin/settings/security | 보안 설정 | Admin |
| PUT | /admin/settings/security | 보안 설정 변경 | Admin |
| | | | |
| GET | /admin/holidays | 공휴일 목록 | Admin |
| POST | /admin/holidays | 공휴일 등록 | Admin |
| DELETE | /admin/holidays/:id | 공휴일 삭제 | Admin |
| | | | |
| GET | /admin/storage | 스토리지 현황 | Admin |
