import Redis from 'ioredis';
import { logger } from './logger';
import { env } from './env';

const base = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  tls: env.REDIS_TLS ? {} : undefined,
  maxRetriesPerRequest: 3,
  connectTimeout: 10_000,
  keepAlive: 10000,
  lazyConnect: true,
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 200, 3000);
  },
};

// Main shared client for all data operations
export const redisMain = new Redis({ ...base, db: 0 });
redisMain.on('connect', () => logger.info(`Redis[main]: connected`));
redisMain.on('error', (e: Error) => logger.error(`Redis[main]: error`, { error: e.message }));

// Pub/Sub dedicated clients
export const redisPub = new Redis({ ...base, db: 0 });
redisPub.on('connect', () => logger.info(`Redis[pub]: connected`));
redisPub.on('error', (e: Error) => logger.error(`Redis[pub]: error`, { error: e.message }));

export const redisSub = new Redis({ ...base, db: 0 });
redisSub.on('connect', () => logger.info(`Redis[sub]: connected`));
redisSub.on('error', (e: Error) => logger.error(`Redis[sub]: error`, { error: e.message }));

// Export aliases pointing to the single shared client to maintain backward compatibility
export const redisQueues    = redisMain;
export const redisSessions  = redisMain;
export const redisPresence  = redisMain;
export const redisRateLimit = redisMain;
export const redisAnalytics = redisMain;

export async function connectRedis(): Promise<void> {
  await Promise.all([
    redisMain.connect(),
    redisPub.connect(),
    redisSub.connect(),
  ]);
  logger.info('Redis: all clients connected ✓');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redisMain.quit(),
    redisPub.quit(),
    redisSub.quit(),
  ]);
  logger.info('Redis: all clients disconnected');
}

export async function getRedisHealth(): Promise<{ status: string; latencyMs?: number }> {
  try {
    const start = Date.now();
    await redisMain.ping();
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch {
    return { status: 'unhealthy' };
  }
}
