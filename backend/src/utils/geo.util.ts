import type { Request } from 'express';
import crypto from 'crypto';
import { hashSensitiveData } from './token.util';

/**
 * Extract real client IP from X-Forwarded-For header (set by Nginx/proxy).
 * Falls back to socket remote address.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0];
    return first.trim();
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

/**
 * Returns a salted hash of the client IP — never store raw IPs.
 */
export function getIpHash(req: Request): string {
  return hashSensitiveData(getClientIp(req));
}

/**
 * Very basic country detection from Cloudflare headers (CF-IPCountry).
 * In production, pair with MaxMind GeoLite2 for fallback.
 */
export function detectCountry(req: Request): string {
  const cfCountry = req.headers['cf-ipcountry'];
  if (cfCountry && typeof cfCountry === 'string' && cfCountry.length === 2) {
    return cfCountry.toUpperCase();
  }
  return 'XX'; // Unknown
}

/**
 * Extract Jaccard similarity between two interest tag arrays.
 * Used by matching engine to score interest overlap.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  const setB = new Set(b.map((t) => t.toLowerCase()));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Generate a cryptographically unique request correlation ID.
 * Uses crypto.randomBytes instead of Math.random to prevent collisions
 * in high-concurrency environments and distributed tracing.
 */
export function getCorrelationId(req: Request): string {
  return (req.headers['x-request-id'] as string) ?? crypto.randomBytes(4).toString('hex');
}

