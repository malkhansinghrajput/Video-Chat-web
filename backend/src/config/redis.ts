import Redis from 'ioredis';
import { logger } from './logger';
import { env } from './env';

// ─────────────────────────────────────────────
// Error throttle: avoid log spam during OOM / outage
// ─────────────────────────────────────────────
function makeErrorThrottle(name: string) {
  let lastLoggedAt = 0;
  return (e: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt > env.REDIS_ERROR_LOG_INTERVAL_MS) {
      lastLoggedAt = now;
      logger.error(`Redis[${name}]: error`, { error: e.message });
    }
  };
}

const base = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  tls: env.REDIS_TLS ? {} : undefined,
  maxRetriesPerRequest: 3,
  connectTimeout: 10_000,
  keepAlive: 10000,
  lazyConnect: true,
  // Prevent command pile-up when Redis is down (OOM/restart)
  enableOfflineQueue: false,
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 200, 3000);
  },
};

function createRedisClient(): Redis {
  // Redis Cloud commonly supplies a TLS URL. Respect it when present; the
  // host/port form remains the default for existing deployments.
  return env.REDIS_URL ? new Redis(env.REDIS_URL, base) : new Redis({ ...base, db: 0 });
}

// Main shared client for all data operations
export const redisMain = createRedisClient();
redisMain.on('connect', () => logger.info(`Redis[main]: connected`));
redisMain.on('error', makeErrorThrottle('main'));

// Pub/Sub dedicated clients
export const redisPub = createRedisClient();
redisPub.on('connect', () => logger.info(`Redis[pub]: connected`));
redisPub.on('error', makeErrorThrottle('pub'));

export const redisSub = createRedisClient();
redisSub.on('connect', () => logger.info(`Redis[sub]: connected`));
redisSub.on('error', makeErrorThrottle('sub'));

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

export async function getRedisHealth(): Promise<{ status: string; latencyMs?: number; memoryUsedMb?: number }> {
  try {
    const start = Date.now();
    await redisMain.ping();
    const latencyMs = Date.now() - start;

    // Try to get memory info (non-fatal if OOM prevents it)
    let memoryUsedMb: number | undefined;
    try {
      const info = await redisMain.info('memory');
      const match = info.match(/used_memory:(\d+)/);
      if (match?.[1]) memoryUsedMb = Math.round(parseInt(match[1], 10) / 1024 / 1024);
    } catch { /* ignore */ }

    return { status: 'healthy', latencyMs, memoryUsedMb };
  } catch {
    return { status: 'unhealthy' };
  }
}

/**
 * Subscribe to a Redis channel with automatic retry on failure.
 * Call this instead of redisSub.subscribe() directly, so OOM errors
 * don't permanently kill the subscription.
 */
export function subscribeToChannel(
  channel: string,
  retryIntervalMs: number,
  onMessage: (msg: string) => void,
): void {
  function attempt() {
    redisSub.subscribe(channel, (err) => {
      if (err) {
        logger.error(`Redis[sub]: failed to subscribe to ${channel} — retrying in ${retryIntervalMs}ms`, {
          error: err.message,
        });
        setTimeout(attempt, retryIntervalMs);
      } else {
        logger.info(`Redis[sub]: subscribed to ${channel}`);
      }
    });
  }

  redisSub.on('message', (_ch: string, message: string) => {
    if (_ch === channel) onMessage(message);
  });

  // Re-subscribe automatically when the connection is restored after a drop
  redisSub.on('ready', () => {
    redisSub.subscribe(channel, (err) => {
      if (err) logger.warn(`Redis[sub]: re-subscribe to ${channel} failed`, { error: err.message });
    });
  });

  attempt();
}

