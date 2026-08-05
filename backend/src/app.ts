import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './config/env';
import { apiRateLimiter } from './middlewares/rateLimit.middleware';
import { correlationMiddleware, requestLoggerMiddleware, errorHandler, notFoundHandler } from './middlewares/common.middleware';

// Routes
import sessionRoutes from './routes/session.routes';
import reportRoutes  from './routes/report.routes';
import healthRoutes  from './routes/health.routes';

// ─────────────────────────────────────────────
// Express Application Factory
// ─────────────────────────────────────────────

export function createApp() {
  const app = express();

  // ── Security Headers ──────────────────────
  app.use(helmet({
    crossOriginEmbedderPolicy: false, // Required for WebRTC
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'wss:', 'ws:'],
      },
    },
  }));

  // ── CORS ──────────────────────────────────
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
    maxAge: 86_400,
  }));

  // ── Compression & Parsing ─────────────────
  app.use(compression());
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  // ── Request Infrastructure ────────────────
  app.use(correlationMiddleware);
  app.use(requestLoggerMiddleware);

  // ── Trust Proxy (Nginx/Cloud LB) ──────────
  app.set('trust proxy', 1);

  // ── Global Rate Limiter ───────────────────
  app.use('/api', apiRateLimiter);

  // ── Routes ───────────────────────────────
  app.use('/health',           healthRoutes);
  app.use('/api/v1/session',   sessionRoutes);
  app.use('/api/v1/reports',   reportRoutes);
  app.use('/api/v1/analytics', healthRoutes); // sub-mounted

  // ── Error Handling ────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
