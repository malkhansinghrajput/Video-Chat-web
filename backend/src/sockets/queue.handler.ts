import type { Server, Socket } from 'socket.io';
import { sessionService } from '../services/session.service';
import { queueService, roomService } from '../services/matching.service';
import { logger, logError } from '../config/logger';
import { SocketEvents, RedisKeys, ErrorCodes, Limits } from '../constants';
import { redisRateLimit, redisAnalytics } from '../config/redis';
import { env } from '../config/env';
import type { SocketData, QueueEntry, JoinQueuePayload } from '../types';

// ─────────────────────────────────────────────
// Queue Event Handlers
// ─────────────────────────────────────────────

export function handleQueueEvents(socket: Socket, _io: Server): void {
  const data = socket.data as SocketData;

  // ── join_queue ───────────────────────────
  socket.on(SocketEvents.JOIN_QUEUE, async (payload: JoinQueuePayload = {}) => {
    try {
      // Rate limit: max 20 queue joins per hour
      const limitKey = RedisKeys.rateLimit.joinQueue(data.sessionId);
      const count = await redisRateLimit.incr(limitKey);
      if (count === 1) await redisRateLimit.expire(limitKey, 3600);
      if (count > 20) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.RATE_LIMITED, message: 'Too many queue joins. Slow down.' });
        return;
      }

      // Check already in queue
      const inQueue = await queueService.isInQueue(data.sessionId);
      if (inQueue) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.ALREADY_IN_QUEUE, message: 'Already in queue' });
        return;
      }

      // Get fresh session
      const session = await sessionService.getSession(data.sessionId);
      if (!session) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.INVALID_SESSION, message: 'Session not found' });
        return;
      }

      if (session.isBanned) {
        socket.emit(SocketEvents.SESSION_BANNED, { reason: 'Banned', isPermanent: false });
        return;
      }
      if (session.status !== 'idle') {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.ALREADY_IN_QUEUE, message: 'Session is not available for matching' });
        return;
      }

      // Build queue entry (use session data, allow preference override)
      const entry: QueueEntry = {
        sessionId: data.sessionId,
        socketId: socket.id,
        country: payload.country ?? session.country,
        language: payload.language ?? session.language,
        interests: payload.interests ?? session.interests,
        joinedAt: Date.now(),
        priority: 0,
      };

      const enqueued = await queueService.enqueue(entry);
      if (!enqueued) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.ALREADY_IN_QUEUE, message: 'Already in queue' });
        return;
      }
      await sessionService.updateSession(data.sessionId, { status: 'searching' } as never);

      const queueDepth = await queueService.getQueueDepth();

      socket.emit(SocketEvents.QUEUE_JOINED, { position: queueDepth });
      socket.emit(SocketEvents.QUEUE_POSITION, {
        position: queueDepth,
        estimatedWaitSeconds: Math.max(5, queueDepth * 3),
        queueDepth,
      });

      logger.debug('QueueHandler: joined', { sessionId: data.sessionId, queueDepth });
    } catch (err) {
      logError('QueueHandler: join_queue error', err, { sessionId: data.sessionId });
      socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.INTERNAL_ERROR, message: 'Failed to join queue' });
    }
  });

  // ── leave_queue ──────────────────────────
  socket.on(SocketEvents.LEAVE_QUEUE, async () => {
    try {
      await queueService.dequeue(data.sessionId, socket.id);
      await sessionService.updateSession(data.sessionId, { status: 'idle' } as never);
      logger.debug('QueueHandler: left queue', { sessionId: data.sessionId });
    } catch (err) {
      logError('QueueHandler: leave_queue error', err);
    }
  });

  // ── chat:next ────────────────────────────
  socket.on(SocketEvents.CHAT_NEXT, async () => {
    try {
      // Rate limit: max N next per window (existing check)
      const limitKey = RedisKeys.rateLimit.next(data.sessionId);
      const count = await redisRateLimit.incr(limitKey);
      if (count === 1) await redisRateLimit.expire(limitKey, env.RATE_LIMIT_NEXT_WINDOW_SECONDS);
      if (count > env.RATE_LIMIT_NEXT_MAX) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.RATE_LIMITED, message: 'Slow down — too many skips.' });
        return;
      }

      // Skip cooldown: prevent button spam (configurable, default 2s)
      const cooldownKey = `cooldown:next:${data.sessionId}`;
      const onCooldown = await redisRateLimit.exists(cooldownKey);
      if (onCooldown) {
        // Silently ignore during cooldown — don't error the user
        return;
      }
      await redisRateLimit.setex(cooldownKey, Math.ceil(env.NEXT_COOLDOWN_MS / 1000), '1');

      // Get session, tear down current room if any
      const session = await sessionService.getSession(data.sessionId);
      if (session?.roomId) {
        // Notify peer
        if (session.peerSocketId) {
          socket.to(session.peerSocketId).emit(SocketEvents.PEER_NEXT, { reason: 'partner_skipped' });
        }
        // ── Immediate room cleanup (prevents ghost rooms) ──────────────
        try {
          await roomService.closeRoom(session.roomId);
        } catch { /* room cleanup is best-effort */ }

        // Decrement active rooms counter
        try { await redisAnalytics.decr(RedisKeys.analytics.activeRooms()); } catch { /* non-fatal */ }

        // Leave socket.io room
        socket.leave(`room:${session.roomId}`);
        await sessionService.updateSession(data.sessionId, {
          status: 'idle',
          roomId: undefined,
          peerId: undefined,
          peerSocketId: undefined,
        } as never);
      }

      // Track skip count for analytics
      try { await redisAnalytics.incr(RedisKeys.analytics.skipCount()); } catch { /* non-fatal */ }

      // Re-enter queue with priority boost
      const freshSession = await sessionService.getSession(data.sessionId);
      if (!freshSession) return;

      const entry: QueueEntry = {
        sessionId: data.sessionId,
        socketId: socket.id,
        country: freshSession.country,
        language: freshSession.language,
        interests: freshSession.interests,
        joinedAt: Date.now(),
        priority: 1,
      };

      const enqueued = await queueService.enqueue(entry);
      if (!enqueued) return;
      await sessionService.updateSession(data.sessionId, { status: 'searching' } as never);
      socket.emit(SocketEvents.QUEUE_JOINED, { position: await queueService.getQueueDepth() });

      logger.debug('QueueHandler: next — requeued', { sessionId: data.sessionId });
    } catch (err) {
      logError('QueueHandler: chat:next error', err);
    }
  });

  // ── chat:leave ───────────────────────────
  socket.on(SocketEvents.CHAT_LEAVE, async () => {
    try {
      const session = await sessionService.getSession(data.sessionId);
      if (session?.peerSocketId) {
        socket.to(session.peerSocketId).emit(SocketEvents.PEER_LEFT, { reason: 'partner_left' });
      }
      if (session?.roomId) {
        // ── Immediate room cleanup (prevents ghost rooms) ──────────────
        try {
          await roomService.closeRoom(session.roomId);
        } catch { /* room cleanup is best-effort */ }

        // Decrement active rooms counter
        try { await redisAnalytics.decr(RedisKeys.analytics.activeRooms()); } catch { /* non-fatal */ }

        socket.leave(`room:${session.roomId}`);
      }
      await queueService.dequeue(data.sessionId, socket.id);
      await sessionService.updateSession(data.sessionId, {
        status: 'idle',
        roomId: undefined,
        peerId: undefined,
        peerSocketId: undefined,
      } as never);

      logger.debug('QueueHandler: user left', { sessionId: data.sessionId });
    } catch (err) {
      logError('QueueHandler: chat:leave error', err);
    }
  });
}

