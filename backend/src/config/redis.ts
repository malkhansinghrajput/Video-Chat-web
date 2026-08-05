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
  lazyConnect: true,
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 200, 3000);
  },
};

function makeClient(db: number, name: string): Redis {
  // Free tier / Managed Redis often only supports DB 0.
  // Using keyPrefix to simulate logical databases.
  const prefix = name === 'pub' || name === 'sub' ? '' : `${name}:`;
  const client = new Redis({ ...base, db: 0, keyPrefix: prefix });
  client.on('connect', () => logger.info(`Redis[${name}]: connected`));
  client.on('error', (e: Error) => logger.error(`Redis[${name}]: error`, { error: e.message }));
  return client;
}

// One client per logical database (per architecture)
export const redisQueues    = makeClient(0, 'queues');
export const redisSessions  = makeClient(1, 'sessions');
export const redisPresence  = makeClient(2, 'presence');
export const redisRateLimit = makeClient(3, 'ratelimit');
export const redisAnalytics = makeClient(5, 'analytics');

// Pub/Sub dedicated client
export const redisPub = makeClient(4, 'pub');
export const redisSub = makeClient(4, 'sub');

export async function connectRedis(): Promise<void> {
  await Promise.all([
    redisQueues.connect(),
    redisSessions.connect(),
    redisPresence.connect(),
    redisRateLimit.connect(),
    redisAnalytics.connect(),
    redisPub.connect(),
    redisSub.connect(),
  ]);
  logger.info('Redis: all clients connected ✓');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redisQueues.quit(),
    redisSessions.quit(),
    redisPresence.quit(),
    redisRateLimit.quit(),
    redisAnalytics.quit(),
    redisPub.quit(),
    redisSub.quit(),
  ]);
  logger.info('Redis: all clients disconnected');
}

export async function getRedisHealth(): Promise<{ status: string; latencyMs?: number }> {
  try {
    const start = Date.now();
    await redisSessions.ping();
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch {
    return { status: 'unhealthy' };
  }
}
