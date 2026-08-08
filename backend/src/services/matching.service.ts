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
   * Queue model: the ZSET contains only session IDs (the FIFO order), while a
   * short-lived hash contains the entry metadata.  Keeping JSON out of the
   * ZSET lets all normal queue operations address a member directly.
   */
  private static readonly enqueueScript = `
    if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
    redis.call('HSET', KEYS[2], 'sessionId', ARGV[1], 'socketId', ARGV[2],
      'country', ARGV[3], 'language', ARGV[4], 'interests', ARGV[5],
      'joinedAt', ARGV[6], 'priority', ARGV[7])
    redis.call('EXPIRE', KEYS[2], ARGV[8])
    redis.call('ZADD', KEYS[1], ARGV[6], ARGV[1])
    return 1
  `;

  private static readonly dequeueScript = `
    redis.call('ZREM', KEYS[1], ARGV[1])
    redis.call('DEL', KEYS[2])
    return 1
  `;

  private static readonly cleanupScript = `
    local members = redis.call('ZRANGE', KEYS[1], 0, ARGV[1] - 1)
    local removed = 0
    for _, member in ipairs(members) do
      if redis.call('EXISTS', ARGV[2] .. member) == 0 then
        redis.call('ZREM', KEYS[1], member)
        removed = removed + 1
      end
    end
    return removed
  `;

  /**
   * Add a user to the global matching queue.
   * Uses timestamp as score for FIFO ordering.
   */
  async enqueue(entry: QueueEntry): Promise<boolean> {
    const result = await redisQueues.eval(
      QueueService.enqueueScript,
      2,
      RedisKeys.queue.global(),
      RedisKeys.queue.entry(entry.sessionId),
      entry.sessionId,
      entry.socketId,
      entry.country,
      entry.language,
      JSON.stringify(entry.interests),
      String(entry.joinedAt),
      String(entry.priority),
      String(env.QUEUE_ENTRY_TTL_SECONDS),
    );
    const inserted = Number(result) === 1;
    if (inserted) logger.debug('QueueService: enqueued', { sessionId: entry.sessionId });
    return inserted;
  }

  /**
   * Remove a user from all queues.
   */
  async dequeue(sessionId: string, socketId: string): Promise<void> {
    // socketId is retained in the signature for compatibility with callers.
    void socketId;
    await redisQueues.eval(
      QueueService.dequeueScript,
      2,
      RedisKeys.queue.global(),
      RedisKeys.queue.entry(sessionId),
      sessionId,
    );
    logger.debug('QueueService: dequeued', { sessionId });
  }

  /**
   * Check if a session is currently in the queue.
   */
  async isInQueue(sessionId: string): Promise<boolean> {
    const exists = await redisQueues.exists(RedisKeys.queue.entry(sessionId));
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
  async cleanStaleEntries(limit = env.QUEUE_CLEANUP_BATCH_SIZE): Promise<number> {
    const removed = await redisQueues.eval(
      QueueService.cleanupScript,
      1,
      RedisKeys.queue.global(),
      String(limit),
      'queue:entry:',
    );

    const removedCount = Number(removed);
    if (removedCount > 0) {
      logger.debug('QueueService: cleaned stale entries', { removed: removedCount });
    }
    return removedCount;
  }

  async getCandidates(limit: number): Promise<QueueEntry[]> {
    const sessionIds = await redisQueues.zrange(RedisKeys.queue.global(), 0, limit - 1);
    if (!sessionIds.length) return [];
    const pipeline = redisQueues.pipeline();
    for (const sessionId of sessionIds) pipeline.hgetall(RedisKeys.queue.entry(sessionId));
    const results = await pipeline.exec();
    const entries: QueueEntry[] = [];
    const stale: string[] = [];
    for (let index = 0; index < sessionIds.length; index++) {
      const data = results?.[index]?.[1] as Record<string, string> | undefined;
      const entry = data && this.hydrateEntry(data);
      if (entry) entries.push(entry);
      else stale.push(sessionIds[index]!);
    }
    if (stale.length) await redisQueues.zrem(RedisKeys.queue.global(), ...stale);
    return entries;
  }

  private hydrateEntry(data: Record<string, string>): QueueEntry | null {
    if (!data['sessionId'] || !data['socketId'] || !data['joinedAt']) return null;
    try {
      return {
        sessionId: data['sessionId'], socketId: data['socketId'],
        country: data['country'] ?? 'XX', language: data['language'] ?? 'en',
        interests: JSON.parse(data['interests'] ?? '[]') as string[],
        joinedAt: Number(data['joinedAt']), priority: Number(data['priority'] ?? 0),
      };
    } catch { return null; }
  }
}

// ─────────────────────────────────────────────
// Room Service
// Manages room creation and teardown
// ─────────────────────────────────────────────

export class RoomService {
  private static readonly commitMatchScript = `
    if redis.call('GET', KEYS[5]) ~= ARGV[1] or redis.call('GET', KEYS[6]) ~= ARGV[1] then return 0 end
    if redis.call('EXISTS', KEYS[7]) == 0 or redis.call('EXISTS', KEYS[8]) == 0 then return 0 end
    if redis.call('EXISTS', KEYS[2]) == 0 or redis.call('EXISTS', KEYS[3]) == 0 then return 0 end
    redis.call('ZREM', KEYS[1], ARGV[2], ARGV[3])
    redis.call('DEL', KEYS[2], KEYS[3])
    redis.call('HSET', KEYS[4], 'roomId', ARGV[4], 'sessionId1', ARGV[2], 'sessionId2', ARGV[3],
      'socketId1', ARGV[5], 'socketId2', ARGV[6], 'createdAt', ARGV[7], 'status', 'active', 'turnCredentials', ARGV[8])
    redis.call('EXPIRE', KEYS[4], ARGV[9])
    redis.call('HSET', KEYS[7], 'status', 'matched', 'roomId', ARGV[4], 'peerId', ARGV[3], 'peerSocketId', ARGV[6], 'matchedAt', ARGV[7])
    redis.call('EXPIRE', KEYS[7], ARGV[10])
    redis.call('HSET', KEYS[8], 'status', 'matched', 'roomId', ARGV[4], 'peerId', ARGV[2], 'peerSocketId', ARGV[5], 'matchedAt', ARGV[7])
    redis.call('EXPIRE', KEYS[8], ARGV[10])
    return 1
  `;
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
  /** Atomically commits queue removal, room creation and both session updates. */
  async createMatchedRoom(a: QueueEntry, b: QueueEntry, ownerToken: string): Promise<Room | null> {
    const roomId = generateRoomId();
    const turnCredentials = sessionService.getTurnCredentials(roomId);
    const createdAt = Date.now();
    const committed = await redisSessions.eval(
      RoomService.commitMatchScript,
      8,
      RedisKeys.queue.global(),
      RedisKeys.queue.entry(a.sessionId),
      RedisKeys.queue.entry(b.sessionId),
      RedisKeys.session.room(roomId),
      RedisKeys.queue.reservation(a.sessionId),
      RedisKeys.queue.reservation(b.sessionId),
      RedisKeys.session.data(a.sessionId),
      RedisKeys.session.data(b.sessionId),
      ownerToken, a.sessionId, b.sessionId, roomId, a.socketId, b.socketId,
      String(createdAt), JSON.stringify(turnCredentials), '7200', String(env.SESSION_TTL_SECONDS),
    );
    if (Number(committed) !== 1) return null;
    return { roomId, sessionIds: [a.sessionId, b.sessionId], socketIds: [a.socketId, b.socketId], createdAt, status: 'active', turnCredentials };
  }

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
  private cleanupTimer: NodeJS.Timeout | null = null;

  private static readonly reservePairScript = `
    if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
    return 1
  `;
  private static readonly releasePairScript = `
    for _, key in ipairs(KEYS) do
      if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key) end
    end
    return 1
  `;

  constructor(
    private readonly queueService: QueueService,
    private readonly roomService: RoomService,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('MatchingEngine: started');
    this.poll();
    this.cleanupTimer = setInterval(() => {
      this.queueService.cleanStaleEntries().catch((err) => logError('MatchingEngine: queue cleanup error', err));
    }, env.QUEUE_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.pollTimer = null;
    this.cleanupTimer = null;
    logger.info('MatchingEngine: stopped');
  }

  get isHealthy(): boolean {
    return this.isRunning;
  }

  private poll(): void {
    if (!this.isRunning) return;
    this.runMatchingCycle()
      .catch((err) => logError('MatchingEngine: poll error', err))
      .finally(async () => {
        // Adaptive polling: fast when queue has candidates, slow when idle
        // This reduces Redis calls by ~90% during off-peak hours
        let interval = env.MATCH_POLL_INTERVAL_MS;
        try {
          const depth = await redisQueues.zcard(RedisKeys.queue.global());
          if (depth < 2) interval = env.MATCH_POLL_IDLE_MS;
        } catch { /* use default interval on Redis error */ }

        this.pollTimer = setTimeout(
          () => this.poll(),
          interval,
        );
      });
  }

  private async runMatchingCycle(): Promise<void> {
    // Candidates remain ordered by their joinedAt ZSET score. The bounded batch
    // prevents one cycle from monopolising the event loop under a large queue.
    const entries = await this.queueService.getCandidates(env.MATCH_CANDIDATE_BATCH_SIZE);

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
          const ownerToken = generateRoomId();
          const reserved = await this.reservePair(a.sessionId, b.sessionId, ownerToken);
          if (!reserved) continue;

          try {
            await this.matchPair(a, b, ownerToken);
            matched.add(a.sessionId);
            matched.add(b.sessionId);
          } finally {
            await this.releasePair(a.sessionId, b.sessionId, ownerToken);
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

  private async reservePair(sessionIdA: string, sessionIdB: string, ownerToken: string): Promise<boolean> {
    const result = await redisQueues.eval(
      MatchingEngine.reservePairScript,
      2,
      RedisKeys.queue.reservation(sessionIdA),
      RedisKeys.queue.reservation(sessionIdB),
      ownerToken,
      '5',
    );
    return Number(result) === 1;
  }

  private async releasePair(sessionIdA: string, sessionIdB: string, ownerToken: string): Promise<void> {
    await redisQueues.eval(
      MatchingEngine.releasePairScript,
      2,
      RedisKeys.queue.reservation(sessionIdA),
      RedisKeys.queue.reservation(sessionIdB),
      ownerToken,
    );
  }

  private async matchPair(a: QueueEntry, b: QueueEntry, ownerToken: string): Promise<void> {
    // A reservation must still belong to this worker immediately before the
    // irreversible transition. This prevents A:B / B:C overlap across workers.
    const reservations = await redisQueues.mget(
      RedisKeys.queue.reservation(a.sessionId),
      RedisKeys.queue.reservation(b.sessionId),
    );
    if (reservations[0] !== ownerToken || reservations[1] !== ownerToken) return;

    // Remove both from queue
    const room = await this.roomService.createMatchedRoom(a, b, ownerToken);
    if (!room) return;

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

    // ── Analytics tracking ──────────────────────────────────────────────
    const now = Date.now();
    const avgWaitMs = Math.round(
      ((now - a.joinedAt) + (now - b.joinedAt)) / 2,
    );
    try {
      await Promise.all([
        redisQueues.incr(RedisKeys.analytics.matchCount()),
        redisQueues.set(RedisKeys.analytics.avgQueueWait(), String(avgWaitMs)),
        redisQueues.incr(RedisKeys.analytics.activeRooms()),
      ]);
    } catch { /* analytics failure must not affect matching */ }

    logger.info('MatchingEngine: matched pair', {
      roomId: room.roomId,
      sessionA: a.sessionId,
      sessionB: b.sessionId,
      avgQueueWaitMs: avgWaitMs,
    });
  }
}

export const queueService = new QueueService();
export const roomService = new RoomService();
export const matchingEngine = new MatchingEngine(queueService, roomService);
