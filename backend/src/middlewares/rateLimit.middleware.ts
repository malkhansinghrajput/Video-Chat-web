import type { Request, Response, NextFunction } from 'express';
import { redisRateLimit } from '../config/redis';
import { getClientIp } from '../utils/geo.util';
import { hashSensitiveData } from '../utils/token.util';
import { env } from '../config/env';
import { ErrorCodes } from '../constants';

/**
 * General API rate limiter using Redis sliding window.
 * Limits by IP hash.
 */
export async function apiRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req);
  const ipHash = hashSensitiveData(ip);
  const key = `ratelimit:api:${ipHash}`;

  const count = await redisRateLimit.incr(key);
  if (count === 1) await redisRateLimit.expire(key, env.RATE_LIMIT_API_WINDOW_SECONDS);

  const remaining = Math.max(0, env.RATE_LIMIT_API_MAX - count);
  res.setHeader('X-RateLimit-Limit', String(env.RATE_LIMIT_API_MAX));
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  if (count > env.RATE_LIMIT_API_MAX) {
    res.status(429).json({
      success: false,
      error: { code: ErrorCodes.RATE_LIMITED, message: 'Too many requests. Please slow down.' },
      timestamp: Date.now(),
    });
    return;
  }

  next();
}

/**
 * Strict rate limiter for session initialization endpoint.
 * Maximum 3 new sessions per IP per hour.
 */
export async function sessionInitRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req);
  const ipHash = hashSensitiveData(ip);
  const key = `ratelimit:init:${ipHash}`;

  const count = await redisRateLimit.incr(key);
  if (count === 1) {
    await redisRateLimit.expire(key, env.RATE_LIMIT_SESSION_INIT_WINDOW_HOURS * 3600);
  }

  if (count > env.RATE_LIMIT_SESSION_INIT_MAX) {
    res.status(429).json({
      success: false,
      error: { code: ErrorCodes.RATE_LIMITED, message: 'Too many session requests. Try again later.' },
      timestamp: Date.now(),
    });
    return;
  }

  next();
}
