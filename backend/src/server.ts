import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis, redisPub, redisSub } from './config/redis';
import { matchingEngine } from './services/matching.service';
import { registerConnectionHandlers, clearAllDisconnectTimers } from './sockets/connection.handler';
import { socketAuthMiddleware } from './middlewares/auth.middleware';
import { logger } from './config/logger';
import { env } from './config/env';

// _____________________________________________
// Bootstrap Function
// Wires up all services and starts listening
// _____________________________________________

async function bootstrap(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting Video Chat Backend...', { env: env.NODE_ENV, port: env.PORT });

  // Connect Dependencies
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

  // HTTP Server
  const app = createApp();
  const httpServer = createServer(app);

  // Build the allowed origins list.
  // Filter '*' from Socket.IO origins when credentials are enabled — browsers
  // reject credentialed requests to wildcard origins (CORS spec).
  const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
  const socketCorsOrigins = corsOrigins.filter((o) => o !== '*');

  // Socket.IO Server
  const io = new SocketServer(httpServer, {
    cors: {
      origin: socketCorsOrigins.length > 0 ? socketCorsOrigins : corsOrigins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: env.HEARTBEAT_INTERVAL_MS,
    pingTimeout: 10_000,
    maxHttpBufferSize: 8 * 1024, // 8 KB max event payload
    connectTimeout: 10_000,
  });

  // Socket.IO Redis Adapter for multi-instance horizontal scaling
  io.adapter(createAdapter(redisPub, redisSub));

  // Socket.IO middleware
  io.use(socketAuthMiddleware);

  // Register all socket event handlers
  registerConnectionHandlers(io);

  // Start Matching Engine
  matchingEngine.start();

  // Listen
  httpServer.listen(env.PORT, () => {
    const duration = Date.now() - startTime;
    const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    // In production the server sits behind a reverse proxy/load balancer.
    // The real public URLs come from DNS/TLS config on the host platform,
    // not from the local port. We only show the internal bind address here.
    const displayHost = env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    logger.info(`\n` +
      `=========================================\n` +
      `SYSTEM READY [${env.NODE_ENV.toUpperCase()}]\n` +
      `=========================================\n` +
      `  Port:       ${env.PORT}\n` +
      `  Node:       ${process.version}\n` +
      `  Duration:   ${duration}ms\n` +
      `  Heap:       ${memory} MB\n` +
      `  Health:     http://${displayHost}:${env.PORT}/health\n` +
      `  API:        http://${displayHost}:${env.PORT}/api/v1\n` +
      `=========================================`
    );
  });

  // Graceful Shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Received ${signal} - shutting down gracefully...`);

    // 1. Stop Matching Engine
    matchingEngine.stop();

    // 2. Clear all pending disconnect timers so none fire after shutdown
    clearAllDisconnectTimers();

    // 3. Stop accepting new requests
    httpServer.close(async (err) => {
      if (err) logger.error('Error closing HTTP server', { error: err.message });
      else logger.info('HTTP server closed');
      
      try {
        // 4. Disconnect existing sockets
        io.disconnectSockets(true);
        logger.info('Socket.IO clients disconnected');
        
        // 5. Close DBs
        await Promise.all([disconnectDatabase(), disconnectRedis()]);
        
        logger.info('All connections closed. Goodbye!');
        process.exit(0);
      } catch (shutdownErr) {
        logger.error('Error during shutdown', { error: String(shutdownErr) });
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
