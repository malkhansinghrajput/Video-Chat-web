import type { Request, Response } from 'express';
import { getDatabaseHealth } from '../config/database';
import { getRedisHealth } from '../config/redis';
import { queueService } from '../services/matching.service';
import { redisAnalytics } from '../config/redis';
import { RedisKeys } from '../constants';

// ─────────────────────────────────────────────
// Health & Analytics Controllers
// ─────────────────────────────────────────────

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

    const isReady = dbHealth.status === 'connected' && redisHealth.status === 'healthy';

    res.status(isReady ? 200 : 503).json({
      ready: isReady,
      checks: {
        mongodb: dbHealth,
        redis: redisHealth,
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
      queueService.getQueueDepth(),
    ]);

    const concurrentUsers = parseInt(
      (await redisAnalytics.get(RedisKeys.analytics.concurrentUsers())) ?? '0',
      10,
    );

    const allHealthy = dbHealth.status === 'connected' && redisHealth.status === 'healthy';

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      service: 'video-chat-backend',
      version: process.env['npm_package_version'] ?? '1.0.0',
      uptime: process.uptime(),
      timestamp: Date.now(),
      checks: {
        mongodb: dbHealth,
        redis: redisHealth,
      },
      stats: {
        concurrentUsers,
        queueDepth,
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  }
}

export class AnalyticsController {
  /**
   * GET /api/v1/analytics/live
   */
  async getLiveStats(_req: Request, res: Response): Promise<void> {
    const [concurrentUsersRaw, queueDepth] = await Promise.all([
      redisAnalytics.get(RedisKeys.analytics.concurrentUsers()),
      queueService.getQueueDepth(),
    ]);

    res.json({
      success: true,
      data: {
        concurrentUsers: parseInt(concurrentUsersRaw ?? '0', 10),
        usersInQueue: queueDepth,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });
  }
}

export const healthController = new HealthController();
export const analyticsController = new AnalyticsController();
