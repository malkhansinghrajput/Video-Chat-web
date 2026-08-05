import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { matchingEngine } from './services/matching.service';
import { registerConnectionHandlers } from './sockets/connection.handler';
import { socketAuthMiddleware } from './middlewares/auth.middleware';
import { logger } from './config/logger';
import { env } from './config/env';

// ─────────────────────────────────────────────
// Bootstrap Function
// Wires up all services and starts listening
// ─────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('🚀 Starting Video Chat Backend...', { env: env.NODE_ENV, port: env.PORT });

  // ── Connect Dependencies ──────────────────
  try {
    await connectRedis();
  } catch (err) {
    logger.error('Failed to connect to Redis', { error: String(err) });
    process.exit(1);
  }

  try {
    await connectDatabase();
  } catch (err) {
    logger.warn('MongoDB connection failed — continuing (non-critical for dev)', { error: String(err) });
    // Don't exit — Redis-only mode usable for development
  }

  // ── HTTP Server ───────────────────────────
  const app = createApp();
  const httpServer = createServer(app);

  // ── Socket.IO Server ──────────────────────
  const io = new SocketServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: env.HEARTBEAT_INTERVAL_MS,
    pingTimeout: 10_000,
    maxHttpBufferSize: 8 * 1024, // 8 KB max event payload
    connectTimeout: 10_000,
  });

  // Socket.IO middleware
  io.use(socketAuthMiddleware);

  // Register all socket event handlers
  registerConnectionHandlers(io);

  // ── Start Matching Engine ─────────────────
  matchingEngine.start();

  // ── Listen ───────────────────────────────
  httpServer.listen(env.PORT, () => {
    logger.info(`✅ Server listening on port ${env.PORT}`);
    logger.info(`   Health:    http://localhost:${env.PORT}/health`);
    logger.info(`   API:       http://localhost:${env.PORT}/api/v1`);
    logger.info(`   Socket.IO: ws://localhost:${env.PORT}`);
  });

  // ── Graceful Shutdown ─────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully...`);

    matchingEngine.stop();

    httpServer.close(async () => {
      logger.info('HTTP server closed');
      try {
        await Promise.all([disconnectDatabase(), disconnectRedis()]);
        logger.info('All connections closed. Goodbye! 👋');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', { error: String(err) });
        process.exit(1);
      }
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
