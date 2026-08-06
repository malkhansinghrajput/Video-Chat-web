import type { Request, Response, NextFunction } from 'express';
import { redisRateLimit } from '../config/redis';
import { getClientIp } from '../utils/geo.util';
import { hashSensitiveData } from '../utils/token.util';
import { env } from '../config/env';
import { ErrorCodes } from '../constants';

// ─────────────────────────────────────────────
// Atomic rate limit increment via Lua script
// Combines INCR + EXPIRE into a single round-trip,
// eliminating the race condition where Redis restarts
// between the two separate calls.
// ─────────────────────────────────────────────
const RATE_LIMIT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

async function atomicRateLimit(key: string, windowSeconds: number): Promise<number> {
  const result = await redisRateLimit.eval(RATE_LIMIT_LUA, 1, key, String(windowSeconds));
  return typeof result === 'number' ? result : parseInt(String(result), 10);
}

/**
 * General API rate limiter using Redis sliding window.
 * Limits by IP hash.
 */
export async function apiRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req);
  const ipHash = hashSensitiveData(ip);
  const key = `ratelimit:api:${ipHash}`;

  const count = await atomicRateLimit(key, env.RATE_LIMIT_API_WINDOW_SECONDS);

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

  const count = await atomicRateLimit(key, env.RATE_LIMIT_SESSION_INIT_WINDOW_HOURS * 3600);

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

