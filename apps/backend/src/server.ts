import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import departmentRoutes from './routes/department.routes';
import approvalRoutes from './routes/approval.routes';
import messengerRoutes from './routes/messenger.routes';

// WebSocket handlers
import { setupMessengerSocket } from './websocket/messenger';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// Global Rate Limiter
app.use(rateLimit({
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다' } },
}));

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.2.0', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/messenger', messengerRoutes);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '요청한 리소스를 찾을 수 없습니다' } });
});

// Error Handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL', message: '서버 내부 오류가 발생했습니다' } });
});

// WebSocket
setupMessengerSocket(io);

httpServer.listen(config.port, () => {
  console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);
});

export { app, io };
