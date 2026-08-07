import { v4 as uuidv4 } from 'uuid';
import { redisSessions, redisAnalytics } from '../config/redis';
import { Session } from '../models/session.model';
import { Ban } from '../models/ban.model';
import {
  generateSessionId,
  generateSessionToken,
  verifySessionToken,
  hashSensitiveData,
  generateTurnCredentials,
} from '../utils/token.util';
import { logger, logError } from '../config/logger';
import { RedisKeys } from '../constants';
import { env } from '../config/env';
import type { AnonymousSession, TurnCredentials } from '../types';

// ─────────────────────────────────────────────
// Session Service
// Manages anonymous session lifecycle
// ─────────────────────────────────────────────

export class SessionService {
  /**
   * Create a new anonymous session.
   * Stores session data in both Redis (fast lookups) and MongoDB (persistence).
   */
  async createSession(params: {
    deviceFingerprint: string;
    ipHash: string;
    country: string;
    language: string;
    interests: string[];
  }): Promise<{ sessionId: string; token: string }> {
    const sessionId = generateSessionId();
    const token = generateSessionToken(sessionId);
    const fingerprintHash = hashSensitiveData(params.deviceFingerprint);

    const session: AnonymousSession = {
      sessionId,
      country: params.country,
      language: params.language,
      interests: params.interests.slice(0, 10),
      status: 'idle',
      deviceFingerprint: fingerprintHash,
      ipHash: params.ipHash,
      createdAt: Date.now(),
      reportCount: 0,
      isBanned: false,
    };

    // Store in Redis with TTL
    const key = RedisKeys.session.data(sessionId);
    await redisSessions.hset(key, this.flattenSession(session));
    await redisSessions.expire(key, env.SESSION_TTL_SECONDS);

    // Store token → sessionId mapping
    const tokenKey = RedisKeys.session.token(token);
    await redisSessions.setex(tokenKey, env.SESSION_TTL_SECONDS, sessionId);

    // Persist to MongoDB async (non-blocking)
    Session.create({
      sessionId,
      deviceFingerprint: fingerprintHash,
      ipHash: params.ipHash,
      country: params.country,
      language: params.language,
      interests: session.interests,
    }).catch((err) => logError('SessionService: failed to persist session', err));

    // Track concurrent users
    await redisAnalytics.incr(RedisKeys.analytics.concurrentUsers());

    logger.debug('SessionService: session created', { sessionId, country: params.country });
    return { sessionId, token };
  }

  /**
   * Validate a session token and return the full session.
   * Returns null if invalid, expired, or banned.
   */
  async validateToken(token: string): Promise<AnonymousSession | null> {
    const sessionId = verifySessionToken(token);
    if (!sessionId) return null;
    return this.getSession(sessionId);
  }

  /**
   * Get session from Redis cache.
   */
  async getSession(sessionId: string): Promise<AnonymousSession | null> {
    const key = RedisKeys.session.data(sessionId);
    const data = await redisSessions.hgetall(key);
    if (!data || !data['sessionId']) return null;
    return this.hydrateSession(data);
  }

  /**
   * Update specific session fields.
   */
  async updateSession(sessionId: string, updates: Partial<AnonymousSession>): Promise<void> {
    const key = RedisKeys.session.data(sessionId);
    const flat = this.flattenSession(updates as AnonymousSession);
    await redisSessions.hset(key, flat);
    await redisSessions.expire(key, env.SESSION_TTL_SECONDS);
  }

  /**
   * Attach a socket ID to a session (on connect/reconnect).
   */
  async attachSocket(sessionId: string, socketId: string): Promise<void> {
    await this.updateSession(sessionId, { socketId } as Partial<AnonymousSession>);
  }

  /**
   * Check if a session is banned (checks Redis cache first, then MongoDB).
   */
  async isBanned(params: {
    sessionId: string;
    ipHash: string;
    fingerprintHash: string;
  }): Promise<{ banned: boolean; reason?: string; until?: number }> {
    // Fast path: check Redis ban cache
    const keys = [
      RedisKeys.ban(params.sessionId),
      RedisKeys.ban(params.ipHash),
      RedisKeys.ban(params.fingerprintHash),
    ];

    for (const key of keys) {
      const ban = await redisSessions.get(key);
      if (ban) {
        const data = JSON.parse(ban) as { reason: string; until?: number };
        return { banned: true, reason: data.reason, until: data.until };
      }
    }

    // Slow path: check MongoDB, but only if connected (graceful fallback for dev)
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const now = new Date();
      const activeBan = await Ban.findOne({
        targetHash: {
          $in: [params.sessionId, params.ipHash, params.fingerprintHash],
        },
        $or: [{ isPermanent: true }, { expiresAt: { $gt: now } }],
      });

      if (activeBan) {
        // Cache in Redis for 5 minutes to avoid repeated DB hits
        const cacheData = JSON.stringify({
          reason: activeBan.reason,
          until: activeBan.expiresAt?.getTime(),
        });
        await redisSessions.setex(RedisKeys.ban(params.sessionId), 300, cacheData);
        return {
          banned: true,
          reason: activeBan.reason,
          until: activeBan.expiresAt?.getTime(),
        };
      }
    }

    return { banned: false };
  }

  /**
   * Destroy a session (on leave or timeout).
   */
  async destroySession(sessionId: string): Promise<void> {
    const key = RedisKeys.session.data(sessionId);
    await redisSessions.del(key);
    await redisAnalytics.decr(RedisKeys.analytics.concurrentUsers());
    logger.debug('SessionService: session destroyed', { sessionId });
  }

  /**
   * Refresh session TTL (called on heartbeat).
   */
  async refreshSession(sessionId: string): Promise<void> {
    const key = RedisKeys.session.data(sessionId);
    await redisSessions.expire(key, env.SESSION_TTL_SECONDS);
  }

  /**
   * Get dynamic TURN credentials for a session.
   */
  getTurnCredentials(sessionId: string): TurnCredentials {
    return generateTurnCredentials(sessionId);
  }

  // ── Helpers ────────────────────────────────

  private flattenSession(session: Partial<AnonymousSession>): Record<string, string> {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(session)) {
      if (v === undefined || v === null) continue;
      flat[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
    return flat;
  }

  private hydrateSession(data: Record<string, string>): AnonymousSession {
    return {
      sessionId:         data['sessionId'] ?? '',
      socketId:          data['socketId'],
      peerId:            data['peerId'],
      peerSocketId:      data['peerSocketId'],
      roomId:            data['roomId'],
      country:           data['country'] ?? 'XX',
      language:          data['language'] ?? 'en',
      interests:         data['interests'] ? (JSON.parse(data['interests']) as string[]) : [],
      status:            (data['status'] as AnonymousSession['status']) ?? 'idle',
      deviceFingerprint: data['deviceFingerprint'] ?? '',
      ipHash:            data['ipHash'] ?? '',
      createdAt:         parseInt(data['createdAt'] ?? '0', 10),
      connectedAt:       data['connectedAt'] ? parseInt(data['connectedAt'], 10) : undefined,
      matchedAt:         data['matchedAt'] ? parseInt(data['matchedAt'], 10) : undefined,
      reportCount:       parseInt(data['reportCount'] ?? '0', 10),
      isBanned:          data['isBanned'] === 'true',
      bannedUntil:       data['bannedUntil'] ? parseInt(data['bannedUntil'], 10) : undefined,
    };
  }
}

export const sessionService = new SessionService();
