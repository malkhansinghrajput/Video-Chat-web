import type { Request, Response } from 'express';
import { getDatabaseHealth } from '../config/database';
import { getRedisHealth } from '../config/redis';
import { queueService, matchingEngine } from '../services/matching.service';
import { redisAnalytics } from '../config/redis';
import { RedisKeys } from '../constants';

// ─────────────────────────────────────────────
// Health & Analytics Controllers
// ─────────────────────────────────────────────

/** Safe Redis get — returns '0' if Redis OOM or unavailable */
async function safeRedisGet(key: string): Promise<string> {
  try {
    return (await redisAnalytics.get(key)) ?? '0';
  } catch {
    return '0';
  }
}

export class HealthController {
  /**
   * GET /health
   * Basic health check — always responds if the server is alive.
   */
  basic(_req: Request, res: Response): void {
    res.json({ status: 'ok', timestamp: Date.now() });
  }

  /**
   * GET /health/live
   * Kubernetes liveness probe — server is running.
   */
  liveness(_req: Request, res: Response): void {
    res.status(200).json({ alive: true });
  }

  /**
   * GET /health/ready
   * Kubernetes readiness probe — all dependencies are connected.
   */
  async readiness(_req: Request, res: Response): Promise<void> {
    const [dbHealth, redisHealth] = await Promise.all([
      Promise.resolve(getDatabaseHealth()),
      getRedisHealth(),
    ]);

    const isMatchingEngineHealthy = matchingEngine.isHealthy;
    const isReady = dbHealth.status === 'connected' && redisHealth.status === 'healthy' && isMatchingEngineHealthy;

    res.status(isReady ? 200 : 503).json({
      ready: isReady,
      checks: {
        mongodb: dbHealth,
        redis: redisHealth,
        matchingEngine: isMatchingEngineHealthy ? 'running' : 'stopped',
      },
      timestamp: Date.now(),
    });
  }

  /**
   * GET /health/detailed
   * Full diagnostic info for internal monitoring.
   */
  async detailed(_req: Request, res: Response): Promise<void> {
    const [dbHealth, redisHealth, queueDepth] = await Promise.all([
      Promise.resolve(getDatabaseHealth()),
      getRedisHealth(),
      queueService.getQueueDepth().catch(() => 0),
    ]);

    const [
      concurrentUsers,
      matchCount,
      skipCount,
      activeRooms,
      avgQueueWaitRaw,
    ] = await Promise.all([
      safeRedisGet(RedisKeys.analytics.concurrentUsers()),
      safeRedisGet(RedisKeys.analytics.matchCount()),
      safeRedisGet(RedisKeys.analytics.skipCount()),
      safeRedisGet(RedisKeys.analytics.activeRooms()),
      safeRedisGet(RedisKeys.analytics.avgQueueWait()),
    ]);

    const matchCountNum = parseInt(matchCount, 10);
    const skipCountNum  = parseInt(skipCount, 10);
    const skipRate      = matchCountNum > 0
      ? Math.round((skipCountNum / matchCountNum) * 100)
      : 0;

    const isMatchingEngineHealthy = matchingEngine.isHealthy;
    const allHealthy = dbHealth.status === 'connected' && redisHealth.status === 'healthy' && isMatchingEngineHealthy;

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      service: 'video-chat-backend',
      version: process.env['npm_package_version'] ?? '1.0.0',
      uptime: process.uptime(),
      region: process.env['REGION'] ?? 'default',
      timestamp: Date.now(),
      checks: {
        mongodb: dbHealth,
        redis: { ...redisHealth },
        matchingEngine: isMatchingEngineHealthy ? 'running' : 'stopped',
      },
      stats: {
        concurrentUsers: parseInt(concurrentUsers, 10),
        queueDepth,
        activeRooms: parseInt(activeRooms, 10),
        matchCount: matchCountNum,
        skipCount: skipCountNum,
        skipRate: `${skipRate}%`,
        avgQueueWaitMs: parseInt(avgQueueWaitRaw, 10),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        cpuUsage: process.cpuUsage(),
      },
    });
  }
}

export class AnalyticsController {
  /**
   * GET /api/v1/analytics/live
   */
  async getLiveStats(_req: Request, res: Response): Promise<void> {
    const [
      concurrentUsersRaw,
      queueDepth,
      matchCountRaw,
      skipCountRaw,
      activeRoomsRaw,
      avgQueueWaitRaw,
    ] = await Promise.all([
      safeRedisGet(RedisKeys.analytics.concurrentUsers()),
      queueService.getQueueDepth().catch(() => 0),
      safeRedisGet(RedisKeys.analytics.matchCount()),
      safeRedisGet(RedisKeys.analytics.skipCount()),
      safeRedisGet(RedisKeys.analytics.activeRooms()),
      safeRedisGet(RedisKeys.analytics.avgQueueWait()),
    ]);

    const matchCount = parseInt(matchCountRaw, 10);
    const skipCount  = parseInt(skipCountRaw, 10);
    const skipRate   = matchCount > 0
      ? Math.round((skipCount / matchCount) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        concurrentUsers:  parseInt(concurrentUsersRaw, 10),
        usersInQueue:     queueDepth,
        activeRooms:      parseInt(activeRoomsRaw, 10),
        matchCount,
        skipCount,
        skipRate:         `${skipRate}%`,
        avgQueueWaitMs:   parseInt(avgQueueWaitRaw, 10),
        timestamp:        Date.now(),
      },
      timestamp: Date.now(),
    });
  }
}

export const healthController  = new HealthController();
export const analyticsController = new AnalyticsController();

