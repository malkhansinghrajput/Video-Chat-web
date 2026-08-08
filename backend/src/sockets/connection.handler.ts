import type { Server, Socket } from 'socket.io';
import { sessionService } from '../services/session.service';
import { queueService } from '../services/matching.service';
import { logger, logError } from '../config/logger';
import { SocketEvents, RedisKeys, ErrorCodes, Limits } from '../constants';
import { redisPresence, redisRateLimit, subscribeToChannel } from '../config/redis';
import { env } from '../config/env';
import type { SocketData } from '../types';
import { handleQueueEvents } from './queue.handler';
import { handleSignalingEvents } from './signaling.handler';
import { handleChatEvents } from './chat.handler';
import { handleReportEvents } from './report.handler';

const disconnectTimers = new Map<string, NodeJS.Timeout>();

// ─────────────────────────────────────────────
// Connection Handler
// Entry point for all socket connections
// ─────────────────────────────────────────────

export function registerConnectionHandlers(io: Server): void {
  // Subscribe to Redis Pub/Sub match events with automatic retry on failure (e.g. OOM)
  setupMatchEventRelay(io);

  io.on('connection', async (socket: Socket) => {
    const data = socket.data as SocketData;
    const { sessionId } = data;

    const pendingDisconnect = disconnectTimers.get(sessionId);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      disconnectTimers.delete(sessionId);
    }

    logger.info('Socket: client connected', { sessionId, socketId: socket.id });

    try {
      // Attach socket to session
      await sessionService.attachSocket(sessionId, socket.id);

      // Set presence
      await redisPresence.setex(
        RedisKeys.presence.socket(socket.id),
        Math.ceil(Limits.HEARTBEAT_INTERVAL_MS / 1000) * 3,
        'online',
      );

      // Join personal room for direct messages
      await socket.join(`session:${sessionId}`);

      // ── Reconnect recovery: restore active room if session was in one ──
      // This allows calls to survive brief internet drops
      try {
        const session = await sessionService.getSession(sessionId);
        if (session?.roomId && (session.status === 'matched' || session.status === 'connected')) {
          await socket.join(`room:${session.roomId}`);
          logger.info('Socket: reconnected to active room', {
            sessionId,
            roomId: session.roomId,
          });
        }
      } catch { /* reconnect recovery is best-effort */ }

      // Register all event handlers
      handleQueueEvents(socket, io);
      handleSignalingEvents(socket, io);
      handleChatEvents(socket, io);
      handleReportEvents(socket, io);
      handleHeartbeat(socket);

      // Handle disconnect
      socket.on('disconnect', async (reason) => {
        await handleDisconnect(socket, io, reason);
      });

    } catch (err) {
      logError('Socket: error during connection setup', err, { sessionId });
      socket.emit(SocketEvents.SESSION_ERROR, {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Connection setup failed',
      });
      socket.disconnect();
    }
  });
}

// ─────────────────────────────────────────────
// Heartbeat Handler
// Tracks last heartbeat timestamp for miss detection
// ─────────────────────────────────────────────

function handleHeartbeat(socket: Socket): void {
  const data = socket.data as SocketData;

  socket.on(SocketEvents.HEARTBEAT, async () => {
    try {
      const now = Date.now();

      // Refresh presence TTL
      await redisPresence.setex(
        RedisKeys.presence.socket(socket.id),
        Math.ceil(Limits.HEARTBEAT_INTERVAL_MS / 1000) * 3,
        'online',
      );

      // Track last heartbeat timestamp for miss detection
      await redisPresence.setex(
        RedisKeys.presence.heartbeat(data.sessionId),
        Math.ceil((Limits.HEARTBEAT_INTERVAL_MS * env.HEARTBEAT_MISS_THRESHOLD) / 1000) + 30,
        String(now),
      );

      await sessionService.refreshSession(data.sessionId);
      socket.emit(SocketEvents.HEARTBEAT_ACK, { timestamp: now });
    } catch (err) {
      logError('Socket: heartbeat error', err);
    }
  });
}

// ─────────────────────────────────────────────
// Disconnect Handler
// ─────────────────────────────────────────────

async function handleDisconnect(socket: Socket, io: Server, reason: string): Promise<void> {
  const data = socket.data as SocketData;
  const { sessionId } = data;

  logger.info('Socket: client disconnected', { sessionId, socketId: socket.id, reason });

  try {
    // Remove presence
    await redisPresence.del(RedisKeys.presence.socket(socket.id));

    // Get session to check if in a room or queue
    const session = await sessionService.getSession(sessionId);
    if (!session) return;

    // If in queue, remove from queue
    if (session.status === 'searching') {
      await queueService.dequeue(sessionId, socket.id);
    }

    // If in a room, notify peer after grace period
    if (session.roomId && (session.status === 'matched' || session.status === 'connected')) {
      const timer = setTimeout(() => {
        void finalizeDisconnect(socket, io, sessionId, session.peerSocketId, session.roomId!);
      }, Limits.RECONNECT_GRACE_PERIOD_MS);
      disconnectTimers.set(sessionId, timer);
    }
  } catch (err) {
    logError('Socket: error during disconnect cleanup', err, { sessionId });
  }
}

async function finalizeDisconnect(
  socket: Socket,
  io: Server,
  sessionId: string,
  peerSocketId: string | undefined,
  roomId: string,
): Promise<void> {
  try {
    disconnectTimers.delete(sessionId);
        // Check if reconnected within grace period
    const current = await sessionService.getSession(sessionId);
    if (!current || current.socketId !== socket.id) return;

    if (peerSocketId) io.to(peerSocketId).emit(SocketEvents.PEER_LEFT, { reason: 'disconnect' });

    await sessionService.updateSession(sessionId, { status: 'idle', roomId: undefined, peerId: undefined, peerSocketId: undefined } as Partial<SocketData>);
  } catch (err) {
    logError('Socket: error finalizing disconnect', err, { sessionId });
  }
}

// ─────────────────────────────────────────────
// Match Event Relay (Redis Pub/Sub → Socket.IO)
// Uses subscribeToChannel for automatic retry on OOM/failure
// ─────────────────────────────────────────────

function setupMatchEventRelay(io: Server): void {
  subscribeToChannel(
    'match:events',
    env.PUBSUB_RETRY_INTERVAL_MS,
    (message) => {
      try {
        const event = JSON.parse(message) as {
          type: string;
          roomId: string;
          turnCredentials: object;
          initiator: { sessionId: string; socketId: string; country: string };
          responder: { sessionId: string; socketId: string; country: string };
          matchedAt: number;
        };

        if (event.type !== 'match_found') return;

        const { initiator, responder, roomId, turnCredentials } = event;

        // Deliver match:found to both peers
        io.to(`session:${initiator.sessionId}`).emit(SocketEvents.MATCH_FOUND, {
          roomId,
          role: 'initiator',
          turnCredentials,
          peerCountry: responder.country,
        });

        io.to(`session:${responder.sessionId}`).emit(SocketEvents.MATCH_FOUND, {
          roomId,
          role: 'responder',
          turnCredentials,
          peerCountry: initiator.country,
        });

        // Join both sockets to room for signaling
        io.in(`session:${initiator.sessionId}`).socketsJoin(`room:${roomId}`);
        io.in(`session:${responder.sessionId}`).socketsJoin(`room:${roomId}`);

        logger.debug('Socket: match event relayed', { roomId });
      } catch (err) {
        logError('Socket: failed to relay match event', err);
      }
    },
  );
}

