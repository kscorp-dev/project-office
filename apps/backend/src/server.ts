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

// WebSocket handlers
import { setupMessengerSocket } from './websocket/messenger';
import { setupMeetingSocket } from './websocket/meeting';
import { setupMailSocket } from './websocket/mail';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
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

// Security Middleware
app.use(helmet());

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
app.use(express.urlencoded({ extended: true }));

// Static file serving (uploads)
import path from 'path';
app.use('/uploads', express.static(path.resolve(config.upload.dir)));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: pkg.version, timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
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

// 404 Handler
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
app.use(notFoundHandler);

// 중앙 에러 핸들러 (Zod, Prisma, AppError를 일관된 응답으로 변환 + pino 로깅)
app.use(errorHandler);

// WebSocket
setupMessengerSocket(io);
setupMeetingSocket(io);
setupMailSocket(io);

// Socket.IO 인스턴스를 app에 저장 (라우트에서 접근 가능)
app.set('io', io);

import { startMailSyncScheduler, runMailSyncOnce } from './workers/mailSync.worker';
import { startAllMailIdle, stopAllMailIdle } from './workers/mailIdle.worker';
import { shutdownMailPool } from './services/mail.service';

httpServer.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv, version: pkg.version }, '🚀 Server started');
  // 기존 콘솔 로그도 유지 (startup 가시성)
  console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);

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
});

// Graceful shutdown — IMAP 풀 + IDLE 워커 정리
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown requested');
  await Promise.allSettled([stopAllMailIdle(), shutdownMailPool()]);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, io };
