// Express 4에서 async route의 throw를 errorHandler로 자동 전달
// (Express 5 이상에서는 기본 동작이라 제거 가능)
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { logger } from './config/logger';
// package.json에서 버전 자동 로드 (하드코딩 방지)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import departmentRoutes from './routes/department.routes';
import approvalRoutes from './routes/approval.routes';
import messengerRoutes from './routes/messenger.routes';
import cctvRoutes from './routes/cctv.routes';
import attendanceRoutes from './routes/attendance.routes';
import calendarRoutes from './routes/calendar.routes';
import boardRoutes from './routes/board.routes';
import taskOrderRoutes from './routes/task-orders.routes';
import inventoryRoutes from './routes/inventory.routes';
import meetingRoutes from './routes/meeting.routes';
import documentRoutes from './routes/document.routes';
import parkingRoutes from './routes/parking.routes';
import adminRoutes from './routes/admin.routes';
import mailAdminRoutes from './routes/mail-admin.routes';
import mailRoutes from './routes/mail.routes';
import notificationRoutes from './routes/notification.routes';
import holidayRoutes from './routes/holiday.routes';
import calendarSyncRoutes from './routes/calendar-sync.routes';
import modulesRoutes from './routes/modules.routes';
import dashboardRoutes from './routes/dashboard.routes';
import delegationRoutes from './routes/delegation.routes';

// WebSocket handlers
import { setupMessengerSocket } from './websocket/messenger';
import { setupMeetingSocket } from './websocket/meeting';
import { setupMailSocket } from './websocket/mail';
import { setupNotificationSocket } from './websocket/notifications';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // payload 크기 제한 (audit 10B C2) — 거대 메시지/메타데이터 인서트 차단
  // 일반 채팅: 5KB / 회의 transcript: 64KB / 첨부 메타: 16KB → 256KB 한도면 충분
  maxHttpBufferSize: 256_000,
});

// Trust proxy (behind Nginx reverse proxy)
app.set('trust proxy', 1);

// HTTP 요청 로깅 (pino-http) — errorHandler보다 먼저 배치해야 요청 컨텍스트가 에러 로그에도 실린다
app.use(pinoHttp({
  logger,
  // 헬스체크/정적 자산 로그는 INFO 대신 DEBUG로 낮춰 노이즈 감소
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (req.url === '/health' || req.url?.startsWith('/uploads')) return 'debug';
    return 'info';
  },
  // 민감 헤더 제거
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
    }),
  },
}));

// Security Middleware (helmet + CSP)
//   API 서버는 직접 HTML 응답 없으나, 잘못된 응답에 사용자 콘텐츠 echo 시 XSS 차단.
//   /uploads 가 인증된 사용자에게 첨부 file 을 직접 서빙하므로 inline script 차단 필요.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // /uploads 의 메일 HTML 본문에서 인라인 style 허용
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"], // SAMEORIGIN — clickjacking 방지
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // /uploads 의 미디어 cross-origin 사용 허용
}));

// CORS — config.corsOrigin은 단일 또는 콤마 구분 여러 Origin 허용
const corsAllowList = config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsAllowList.length === 1 && corsAllowList[0] === '*' ? '*' : corsAllowList,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// CSRF 보완: state-changing 요청의 Origin/Referer 검증
// (CORS 이후에 배치 — preflight는 통과하고 실제 요청만 검사)
import { originCheck } from './middleware/originCheck';
app.use(originCheck);

// Global Rate Limiter
app.use(rateLimit({
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다' } },
}));

// Body Parser
app.use(express.json({ limit: '10mb' }));
// urlencoded 는 form 제출 거의 안 쓰지만 보안상 best-practice 설정 (audit 10B H4)
//   extended: false — qs 파서 대신 querystring 사용 (parameter pollution / prototype pollution 차단)
//   parameterLimit: 100 — Hash collision DoS 방지
//   limit: '1mb' — 폼 본문 충분 (대용량은 multipart 사용)
app.use(express.urlencoded({ extended: false, parameterLimit: 100, limit: '1mb' }));

// Static file serving (uploads) — 인증 필수 (audit 7차 C1)
//   과거 무인증 노출이라 첨부 파일 IDOR 취약점이었음. 인증된 사용자만 접근 가능.
//   resource 별 세밀한 권한 검증은 각 모듈의 별도 download route(예: /api/approvals/.../file)
//   에서 처리. /uploads 는 fallback 으로 메신저 첨부, 회의 자료 등 UUID 파일명 기반 noise.
//   이미지 토큰을 헤더로 못 보내는 케이스(<img> 직접 src) 는 token 쿼리스트링도 허용.
import path from 'path';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
  // 1) Authorization 헤더 우선
  let token: string | undefined;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) token = auth.slice(7);
  // 2) <img>/native Image 같이 헤더 못 보내는 경우 query.token 허용
  if (!token && typeof req.query.token === 'string') token = req.query.token;
  if (!token) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } });
    return;
  }
  try {
    jwt.verify(token, config.jwt.accessSecret);
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: '토큰이 유효하지 않습니다' } });
  }
}, express.static(path.resolve(config.upload.dir)));

// Health check — liveness (단순 process alive 확인)
//   container orchestrator(K8s/Compose) 의 healthcheck 가 호출
//   DB 연결 끊겨도 200 — 그 사이 회복 가능. liveness는 process crash 만 감지.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: pkg.version, timestamp: new Date().toISOString() });
});

// Readiness — DB + Redis 정상 connectivity 까지 확인 (트래픽 받을 준비 됐는지)
//   외부에서 트래픽 라우팅 결정 시 사용 — DB 끊긴 상태에서 503 반환해 새 트래픽 차단.
app.get('/ready', async (_req, res) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
  // DB ping
  try {
    const t0 = Date.now();
    const prismaModule = await import('./config/prisma');
    await prismaModule.default.$queryRaw`SELECT 1`;
    checks.db = { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    checks.db = { ok: false, error: (err as Error).message };
  }
  // Redis ping (옵션 — REDIS_URL 설정된 경우만)
  if (process.env.REDIS_URL) {
    try {
      const t0 = Date.now();
      // ioredis 가 lazy connect 라 ping 까지는 connect 시도
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
      await r.connect();
      await r.ping();
      checks.redis = { ok: true, latencyMs: Date.now() - t0 };
      r.disconnect();
    } catch (err) {
      checks.redis = { ok: false, error: (err as Error).message };
    }
  }
  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ready' : 'not_ready',
    version: pkg.version,
    timestamp: new Date().toISOString(),
    checks,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/approvals/delegations', delegationRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/messenger', messengerRoutes);
app.use('/api/cctv', cctvRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/board', boardRoutes);
app.use('/api/task-orders', taskOrderRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/meeting', meetingRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/parking', parkingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/mail', mailAdminRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/calendar-sync', calendarSyncRoutes);
app.use('/api/modules', modulesRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 404 Handler
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
app.use(notFoundHandler);

// 중앙 에러 핸들러 (Zod, Prisma, AppError를 일관된 응답으로 변환 + pino 로깅)
app.use(errorHandler);

// WebSocket
setupMessengerSocket(io);
setupMeetingSocket(io);
setupMailSocket(io);
setupNotificationSocket(io);

// Socket.IO 인스턴스를 app에 저장 (라우트에서 접근 가능)
app.set('io', io);

import { startMailSyncScheduler, runMailSyncOnce } from './workers/mailSync.worker';
import { startAllMailIdle, stopAllMailIdle } from './workers/mailIdle.worker';
import { shutdownMailPool } from './services/mail.service';
import { startVacationAccrualScheduler, stopVacationAccrualScheduler } from './workers/vacationAccrual.worker';
import { shutdownAllStreams } from './services/cctv-stream.service';
import { pushHealthCheck } from './services/push.service';

httpServer.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv, version: pkg.version }, '🚀 Server started');
  // 기존 콘솔 로그도 유지 (startup 가시성)
  console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);

  // 푸시 환경 헬스체크 — 부팅 시 1회 (운영자가 "왜 푸시 안 가지?" 디버그 시간 단축)
  setTimeout(() => {
    pushHealthCheck()
      .then((h) => {
        logger.info(
          {
            enabled: h.enabled,
            hasAccessToken: h.hasAccessToken,
            devices: { ios: h.iosDevices, android: h.androidDevices, total: h.totalActiveDevices },
          },
          '📱 Push notifications health',
        );
        for (const w of h.warnings) logger.warn({ msg: w }, '[push] warning');
      })
      .catch((err) => logger.warn({ err: (err as Error).message }, '[push] health check failed'));
  }, 1500);

  // 메일 동기화 스케줄러 시작 (기본 5분 주기)
  // 환경변수 DISABLE_MAIL_SYNC=1이면 비활성화 (테스트/CI용)
  if (process.env.DISABLE_MAIL_SYNC !== '1') {
    startMailSyncScheduler();
    // 서버 기동 후 즉시 1회 실행 → 캐시를 빠르게 채움 (2초 지연 후 비동기)
    setTimeout(() => {
      runMailSyncOnce().catch((err) => logger.warn({ err: (err as Error).message }, 'Initial mail sync failed'));
    }, 2000);
  }

  // IMAP IDLE 실시간 감시 시작 (DISABLE_MAIL_IDLE=1이면 비활성화)
  if (process.env.DISABLE_MAIL_IDLE !== '1') {
    setTimeout(() => {
      startAllMailIdle().catch((err) => logger.warn({ err: (err as Error).message }, 'Initial mail idle start failed'));
    }, 3000);
  }

  // 연차 자동 부여 스케줄러 (매년 1/1 01:00 KST + 매월 1일 01:30 KST)
  startVacationAccrualScheduler();
});

// Graceful shutdown — IMAP / IDLE / FFmpeg / Socket.IO / Prisma 모두 정리
//   K8s default grace 30s — 진행중 요청 완료 대기 + 새 요청 차단 + 리소스 close
let shutdownInProgress = false;
const shutdown = async (signal: string) => {
  if (shutdownInProgress) return; // 중복 호출 방지
  shutdownInProgress = true;
  logger.info({ signal }, 'Shutdown requested');

  // 1) 새 요청 차단 — httpServer.close() 는 listen 중지 + 진행중 요청은 완료 대기
  httpServer.close((err) => {
    if (err) logger.warn({ err }, 'httpServer close error');
  });

  // 2) Socket.IO 연결 종료 (모든 클라이언트 disconnect 알림)
  try {
    io.disconnectSockets();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  } catch (err) {
    logger.warn({ err }, 'Socket.IO close error');
  }

  // 3) 워커 / 스케줄러 정리
  stopVacationAccrualScheduler();
  await Promise.allSettled([
    stopAllMailIdle(),
    shutdownMailPool(),
    shutdownAllStreams(),
  ]);

  // 4) DB 연결 정리 (prisma 종료) — 마지막에 (앞에서 진행중 트랜잭션 완료 대기)
  try {
    const prismaModule = await import('./config/prisma');
    await prismaModule.default.$disconnect();
  } catch (err) {
    logger.warn({ err }, 'Prisma disconnect error');
  }

  logger.info({ signal }, 'Shutdown complete');
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// 강제 종료 fallback — 25초 (K8s default 30s grace 안에)
process.on('SIGTERM', () => setTimeout(() => process.exit(1), 25000).unref());
process.on('SIGINT', () => setTimeout(() => process.exit(1), 25000).unref());

// Unhandled error 로깅 — process 가 silent 하게 죽지 않게
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection');
  // production 에선 process exit 안 함 — 단일 unhandled rejection 으로 전체 서버 죽이지 않음
});
process.on('uncaughtException', (err) => {
  logger.error({ err: { message: err.message, stack: err.stack } }, 'Uncaught exception — exiting');
  // 진짜 위험한 상태 — graceful shutdown 후 종료
  shutdown('uncaughtException').catch(() => process.exit(1));
});

export { app, io };
