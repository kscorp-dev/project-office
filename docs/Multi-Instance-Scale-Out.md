# 다중 인스턴스 (Scale-Out) 운영 가이드

마지막 갱신: 2026-04-30 (v0.23.6)

현재 백엔드는 **단일 인스턴스 운영을 가정**하고 설계되었습니다. K8s replica=N 또는
PM2 cluster 모드로 scale-out 시 다음 3가지 항목이 동시 위험으로 발현되므로,
scale-out 전 이 문서의 절차에 따라 인프라 보강이 필요합니다.

## ⚠️ 단일 인스턴스에서는 즉시 위험 없음

현재 production (`43-200-29-148`) 은 단일 EC2 / 단일 backend 컨테이너이므로
아래 항목들은 **활성화되지 않은 잠재 위험**입니다. 트래픽 증가로 scale-out 결정 전
선제 작업하세요.

---

## 1. Rate Limiter — Redis Store

### 현재 상태 (위험)

`express-rate-limit` 가 default `MemoryStore` 를 사용해 인스턴스마다 카운터가 분리됩니다.
인스턴스 N개라면 로그인 brute force 한도 5회 → **N×5 회 우회 가능**.

```ts
// apps/backend/src/server.ts:121
app.use(rateLimit({ windowMs: ..., max: ... })); // ❌ MemoryStore
// apps/backend/src/routes/auth.routes.ts:14
const loginLimiter = rateLimit({ ... }); // ❌ 동일
```

### 수정안

```bash
npm install rate-limit-redis ioredis
```

```ts
// apps/backend/src/config/redis.ts (NEW)
import Redis from 'ioredis';
export const redisClient = new Redis(process.env.REDIS_URL!, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 3,
});

// apps/backend/src/server.ts
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from './config/redis';

app.use(rateLimit({
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
  }),
  // ... 기존 옵션
}));
```

같은 패턴을 모든 라우트별 limiter (admin push test / meeting ring / member add /
auth login / register / calendar feed) 에 적용.

### 영향
- 모든 인스턴스가 동일한 카운터 공유 → brute force / DDoS 차단 일관성 유지
- Redis 가 SPoF — 이미 메인 의존성이라 추가 SPoF 없음

---

## 2. Socket.IO Redis Adapter

### 현재 상태 (위험)

`@socket.io/redis-adapter` 가 미설치. 인스턴스 A 에서 broadcast 한 메시지가
인스턴스 B 에 연결된 클라이언트에게 **도달하지 않음**. 메신저/회의/알림 모두 영향.

### 수정안

```bash
npm install @socket.io/redis-adapter ioredis
```

```ts
// apps/backend/src/server.ts
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

const pubClient = new Redis(process.env.REDIS_URL!);
const subClient = pubClient.duplicate();

const io = new SocketIOServer(httpServer, {
  // ... 기존 옵션
  adapter: createAdapter(pubClient, subClient),
});
```

### Sticky session

WebSocket polling fallback 사용 시 sticky session 필요. nginx 의 `ip_hash` 또는
ALB 의 stickiness 활성화. 또는 polling 비활성으로 항상 websocket transport.

### 영향
- 모든 인스턴스가 동일 채널을 받음 → 메시지/회의 broadcast 일관
- Redis pub/sub 부하 증가 (메시지당 N publish)

---

## 3. Cron / Worker — Leader Election

### 현재 상태 (위험)

`node-cron` 기반 워커 3개가 in-process 실행. 인스턴스 N개라면:

| 워커 | 영향 |
|-----|------|
| `vacationAccrual.worker` | 매년 1/1 01:00 KST 연차 부여 — N×15일 부여 (잔여 폭증) |
| `mailSync.worker` | 5분마다 IMAP fetch — N개 인스턴스가 동일 메일박스 N×lock |
| `mailIdle.worker` | IMAP IDLE 동시 listen — N×알림 |

### 수정안 — Postgres Advisory Lock 패턴

```ts
// apps/backend/src/utils/leaderLock.ts (NEW)
import prisma from '../config/prisma';

const LEADER_LOCK_KEYS = {
  vacation_accrual: 1001,
  mail_sync: 1002,
  mail_idle: 1003,
};

export async function tryAcquireLeader(key: keyof typeof LEADER_LOCK_KEYS): Promise<boolean> {
  // pg_try_advisory_lock — 이미 잡힌 lock 이면 false (NON-BLOCKING)
  const rows = await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
    SELECT pg_try_advisory_lock(${LEADER_LOCK_KEYS[key]})
  `;
  return rows[0]?.pg_try_advisory_lock === true;
}

export async function releaseLeader(key: keyof typeof LEADER_LOCK_KEYS): Promise<void> {
  await prisma.$executeRaw`SELECT pg_advisory_unlock(${LEADER_LOCK_KEYS[key]})`;
}
```

```ts
// apps/backend/src/workers/vacationAccrual.worker.ts
cron.schedule('0 1 1 1 *', async () => {
  if (!await tryAcquireLeader('vacation_accrual')) {
    logger.info('[vacation-accrual] 다른 인스턴스가 처리 중 — skip');
    return;
  }
  try {
    await runAccrualBatch();
  } finally {
    await releaseLeader('vacation_accrual');
  }
}, { timezone: 'Asia/Seoul' });
```

### 영향
- 시점에 정확히 1개 인스턴스만 실행 → 멱등성 + 정확성 보장
- DB 연결만 유지되면 동작 (별도 인프라 X)

---

## 4. 검증 절차

scale-out 후 첫 24시간 모니터링:

1. **rate limit 검증** — 동일 IP 에서 N+1 회 시도 → 차단 확인 (Redis monitor 로 카운터 공유 확인)
2. **WebSocket 메시지** — 인스턴스 A 사용자에게 인스턴스 B 의 알림이 실시간 도착
3. **Cron** — 다음 cron tick 시 로그에서 한 인스턴스만 "처리 중" 다른 인스턴스 "skip"
4. **graceful rolling restart** — kubectl rollout restart 시 active connection drop 0건

## 5. 작업 견적

- Rate limit Redis store: 0.5일 (의존성 + config + 4개 라우트)
- Socket.IO Redis adapter: 1일 (의존성 + sticky session 검증 + 4개 namespace)
- Leader election: 1일 (3개 워커 + 회복 시나리오 테스트)

총 2.5일 작업. Scale-out 결정 시점에 진행 권장.

## 6. 우회 / 임시 대안

scale-out 이 일정상 어려우면:
- **수직 확장 (vertical)** — EC2 인스턴스 size 업그레이드 (CPU/메모리)
- **읽기 분산 only** — read replica 만 추가, write 는 단일 backend
- **Frontend CDN** — 정적 자산만 CloudFront 등에서 분산
