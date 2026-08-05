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
  const startTime = Date.now();
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
    // connectDatabase handles exiting in production if it fails.
    logger.error('Failed to connect to MongoDB', { error: String(err) });
    process.exit(1);
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
    const duration = Date.now() - startTime;
    const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    logger.info(`\n` +
      `=========================================\n` +
      `✅ SYSTEM READY [${env.NODE_ENV.toUpperCase()}]\n` +
      `=========================================\n` +
      `  Port:       ${env.PORT}\n` +
      `  Node:       ${process.version}\n` +
      `  Duration:   ${duration}ms\n` +
      `  Heap:       ${memory} MB\n` +
      `  API:        http://localhost:${env.PORT}/api/v1\n` +
      `  Health:     http://localhost:${env.PORT}/health\n` +
      `  Socket.IO:  ws://localhost:${env.PORT}\n` +
      `=========================================`
    );
  });

  // ── Graceful Shutdown ─────────────────────
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Received ${signal} — shutting down gracefully...`);

    // 1. Stop Matching Engine
    matchingEngine.stop();

    // 2. Stop accepting new requests
    httpServer.close(async (err) => {
      if (err) logger.error('Error closing HTTP server', { error: err.message });
      else logger.info('HTTP server closed');
      
      try {
        // 3. Disconnect existing sockets
        io.disconnectSockets(true);
        logger.info('Socket.IO clients disconnected');
        
        // 4. Close DBs
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
      logger.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
    shutdown('unhandledRejection');
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
