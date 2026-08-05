import { redisQueues, redisSessions, redisPub } from '../config/redis';
import { generateRoomId } from '../utils/token.util';
import { jaccardSimilarity } from '../utils/geo.util';
import { logger, logError } from '../config/logger';
import { RedisKeys, PubSubChannels, Limits } from '../constants';
import { sessionService } from './session.service';
import { env } from '../config/env';
import type { QueueEntry, MatchResult, Room } from '../types';

// ─────────────────────────────────────────────
// Queue Service
// Manages the matching queue (Redis Sorted Sets)
// ─────────────────────────────────────────────

export class QueueService {
  /**
   * Add a user to the global matching queue.
   * Uses timestamp as score for FIFO ordering.
   */
  async enqueue(entry: QueueEntry): Promise<void> {
    const key = RedisKeys.queue.global();
    const value = JSON.stringify(entry);
    const score = entry.joinedAt;

    // Add to global queue
    await redisQueues.zadd(key, score, value);

    // Add to country-specific queue for faster country matching
    if (entry.country !== 'XX') {
      const countryKey = RedisKeys.queue.byCountry(entry.country);
      await redisQueues.zadd(countryKey, score, value);
      await redisQueues.expire(countryKey, Limits.QUEUE_ENTRY_TTL_SECONDS * 2);
    }

    // Set TTL on global queue entries via separate tracker
    await redisQueues.setex(
      `queue:entry:${entry.sessionId}`,
      Limits.QUEUE_ENTRY_TTL_SECONDS,
      '1',
    );

    logger.debug('QueueService: enqueued', { sessionId: entry.sessionId });
  }

  /**
   * Remove a user from all queues.
   */
  async dequeue(sessionId: string, socketId: string): Promise<void> {
    // We must find and remove the entry by scanning (sessionId embedded in JSON)
    // This is O(N) but acceptable at this scale; at 100k+ migrate to hash index
    const entries = await redisQueues.zrange(RedisKeys.queue.global(), 0, -1);
    for (const raw of entries) {
      try {
        const entry = JSON.parse(raw) as QueueEntry;
        if (entry.sessionId === sessionId || entry.socketId === socketId) {
          await redisQueues.zrem(RedisKeys.queue.global(), raw);
          if (entry.country !== 'XX') {
            await redisQueues.zrem(RedisKeys.queue.byCountry(entry.country), raw);
          }
          break;
        }
      } catch { /* ignore parse errors */ }
    }
    await redisQueues.del(`queue:entry:${sessionId}`);
    logger.debug('QueueService: dequeued', { sessionId });
  }

  /**
   * Check if a session is currently in the queue.
   */
  async isInQueue(sessionId: string): Promise<boolean> {
    const ttlKey = `queue:entry:${sessionId}`;
    const exists = await redisQueues.exists(ttlKey);
    return exists === 1;
  }

  /**
   * Get the current queue depth.
   */
  async getQueueDepth(): Promise<number> {
    return redisQueues.zcard(RedisKeys.queue.global());
  }

  /**
   * Remove stale entries from the queue (entries whose TTL key has expired).
   * Called by the cleanup worker periodically.
   */
  async cleanStaleEntries(): Promise<number> {
    const entries = await redisQueues.zrange(RedisKeys.queue.global(), 0, -1);
    let removed = 0;

    for (const raw of entries) {
      try {
        const entry = JSON.parse(raw) as QueueEntry;
        const ttlKey = `queue:entry:${entry.sessionId}`;
        const exists = await redisQueues.exists(ttlKey);

        if (!exists) {
          await redisQueues.zrem(RedisKeys.queue.global(), raw);
          if (entry.country !== 'XX') {
            await redisQueues.zrem(RedisKeys.queue.byCountry(entry.country), raw);
          }
          removed++;
        }
      } catch { /* ignore */ }
    }

    if (removed > 0) {
      logger.debug('QueueService: cleaned stale entries', { removed });
    }
    return removed;
  }
}

// ─────────────────────────────────────────────
// Room Service
// Manages room creation and teardown
// ─────────────────────────────────────────────

export class RoomService {
  /**
   * Create a room for two matched users.
   */
  async createRoom(
    sessionId1: string,
    socketId1: string,
    sessionId2: string,
    socketId2: string,
  ): Promise<Room> {
    const roomId = generateRoomId();
    const turnCredentials = sessionService.getTurnCredentials(roomId);

    const room: Room = {
      roomId,
      sessionIds: [sessionId1, sessionId2],
      socketIds: [socketId1, socketId2],
      createdAt: Date.now(),
      status: 'active',
      turnCredentials,
    };

    const key = RedisKeys.session.room(roomId);
    await redisSessions.hset(key, {
      roomId,
      sessionId1,
      sessionId2,
      socketId1,
      socketId2,
      createdAt: String(room.createdAt),
      status: 'active',
      turnCredentials: JSON.stringify(turnCredentials),
    });
    await redisSessions.expire(key, 7200); // 2 hours max room lifetime

    logger.debug('RoomService: room created', { roomId, sessionId1, sessionId2 });
    return room;
  }

  /**
   * Get room data from Redis.
   */
  async getRoom(roomId: string): Promise<Room | null> {
    const key = RedisKeys.session.room(roomId);
    const data = await redisSessions.hgetall(key);
    if (!data || !data['roomId']) return null;

    return {
      roomId: data['roomId']!,
      sessionIds: [data['sessionId1']!, data['sessionId2']!],
      socketIds:  [data['socketId1']!,  data['socketId2']!],
      createdAt:  parseInt(data['createdAt'] ?? '0', 10),
      status:     (data['status'] as Room['status']) ?? 'active',
      turnCredentials: JSON.parse(data['turnCredentials'] ?? '{}') as Room['turnCredentials'],
    };
  }

  /**
   * Close and delete a room.
   */
  async closeRoom(roomId: string): Promise<void> {
    const key = RedisKeys.session.room(roomId);
    await redisSessions.del(key);
    logger.debug('RoomService: room closed', { roomId });
  }

  /**
   * Verify a session is a member of a room.
   */
  async isRoomMember(roomId: string, sessionId: string): Promise<boolean> {
    const room = await this.getRoom(roomId);
    if (!room) return false;
    return room.sessionIds.includes(sessionId);
  }

  /**
   * Get the peer's socket ID from a room.
   */
  async getPeerSocketId(roomId: string, mySessionId: string): Promise<string | null> {
    const room = await this.getRoom(roomId);
    if (!room) return null;
    const idx = room.sessionIds.indexOf(mySessionId);
    if (idx === -1) return null;
    return room.socketIds[idx === 0 ? 1 : 0] ?? null;
  }
}

// ─────────────────────────────────────────────
// Matching Engine
// Core matching algorithm with progressive relaxation
// ─────────────────────────────────────────────

export class MatchingEngine {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly queueService: QueueService,
    private readonly roomService: RoomService,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('MatchingEngine: started');
    this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    logger.info('MatchingEngine: stopped');
  }

  private poll(): void {
    if (!this.isRunning) return;
    this.runMatchingCycle()
      .catch((err) => logError('MatchingEngine: poll error', err))
      .finally(() => {
        this.pollTimer = setTimeout(
          () => this.poll(),
          env.MATCH_POLL_INTERVAL_MS,
        );
      });
  }

  private async runMatchingCycle(): Promise<void> {
    // Get all candidates in FIFO order
    const rawEntries = await redisQueues.zrange(RedisKeys.queue.global(), 0, -1, 'WITHSCORES');

    const entries: QueueEntry[] = [];
    for (let i = 0; i < rawEntries.length; i += 2) {
      try {
        entries.push(JSON.parse(rawEntries[i]!) as QueueEntry);
      } catch { /* skip malformed */ }
    }

    if (entries.length < 2) return;

    const now = Date.now();
    const matched = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!;
      if (matched.has(a.sessionId)) continue;

      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j]!;
        if (matched.has(b.sessionId)) continue;

        const waitA = (now - a.joinedAt) / 1000;
        const waitB = (now - b.joinedAt) / 1000;
        const minWait = Math.min(waitA, waitB);

        if (this.isCompatible(a, b, minWait)) {
          const lockKey = [a.sessionId, b.sessionId].sort().join(':');
          const lockAcquired = await this.acquireLock(lockKey);
          if (!lockAcquired) continue;

          try {
            await this.matchPair(a, b);
            matched.add(a.sessionId);
            matched.add(b.sessionId);
          } finally {
            await redisQueues.del(`match:lock:${lockKey}`);
          }
          break; // a is matched, move to next
        }
      }
    }
  }

  private isCompatible(a: QueueEntry, b: QueueEntry, minWaitSeconds: number): boolean {
    // Country match: strict until COUNTRY_RELAX threshold, then global
    const countryRelax = Limits.MATCH_COUNTRY_RELAX_SECONDS;
    if (minWaitSeconds < countryRelax && a.country !== b.country) return false;

    // Language match: strict until LANG_RELAX threshold
    const langRelax = Limits.MATCH_LANG_RELAX_SECONDS;
    if (minWaitSeconds < langRelax && a.language !== b.language) return false;

    // Interest similarity: require Jaccard >= 0.3 until INTEREST_RELAX threshold
    const interestRelax = Limits.MATCH_INTEREST_RELAX_SECONDS;
    if (
      minWaitSeconds < interestRelax &&
      a.interests.length > 0 &&
      b.interests.length > 0
    ) {
      const sim = jaccardSimilarity(a.interests, b.interests);
      if (sim < 0.3) return false;
    }

    return true;
  }

  private async acquireLock(id: string): Promise<boolean> {
    const key = `match:lock:${id}`;
    const result = await redisQueues.set(key, '1', 'EX', 5, 'NX');
    return result === 'OK';
  }

  private async matchPair(a: QueueEntry, b: QueueEntry): Promise<void> {
    // Remove both from queue
    await this.queueService.dequeue(a.sessionId, a.socketId);
    await this.queueService.dequeue(b.sessionId, b.socketId);

    // Create room
    const room = await this.roomService.createRoom(
      a.sessionId, a.socketId,
      b.sessionId, b.socketId,
    );

    // Update session statuses
    await Promise.all([
      sessionService.updateSession(a.sessionId, {
        status: 'matched',
        roomId: room.roomId,
        peerId: b.sessionId,
        peerSocketId: b.socketId,
        matchedAt: Date.now(),
      } as Partial<import('../types').AnonymousSession>),
      sessionService.updateSession(b.sessionId, {
        status: 'matched',
        roomId: room.roomId,
        peerId: a.sessionId,
        peerSocketId: a.socketId,
        matchedAt: Date.now(),
      } as Partial<import('../types').AnonymousSession>),
    ]);

    // Publish match event for signaling nodes to deliver
    const matchEvent = {
      type: 'match_found',
      roomId: room.roomId,
      turnCredentials: room.turnCredentials,
      initiator: { sessionId: a.sessionId, socketId: a.socketId, country: a.country },
      responder: { sessionId: b.sessionId, socketId: b.socketId, country: b.country },
      matchedAt: room.createdAt,
    };

    await redisPub.publish(PubSubChannels.MATCH_EVENTS, JSON.stringify(matchEvent));
    logger.info('MatchingEngine: matched pair', {
      roomId: room.roomId,
      sessionA: a.sessionId,
      sessionB: b.sessionId,
    });
  }
}

export const queueService = new QueueService();
export const roomService = new RoomService();
export const matchingEngine = new MatchingEngine(queueService, roomService);
