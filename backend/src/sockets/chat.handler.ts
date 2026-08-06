import type { Server, Socket } from 'socket.io';
import { roomService } from '../services/matching.service';
import { sessionService } from '../services/session.service';
import { logger, logError } from '../config/logger';
import { SocketEvents, RedisKeys, ErrorCodes, Limits } from '../constants';
import { redisRateLimit } from '../config/redis';
import { env } from '../config/env';
import type { SocketData } from '../types';

// ─────────────────────────────────────────────
// Chat Event Handlers
// Text chat relay with rate limiting
// ─────────────────────────────────────────────

export function handleChatEvents(socket: Socket, _io: Server): void {
  const data = socket.data as SocketData;

  socket.on(SocketEvents.CHAT_MESSAGE, async (payload: Record<string, unknown>) => {
    try {
      // ── Payload normalization ─────────────────────────────────────────
      // Frontend sends { text } but types defined { message }.
      // Accept both fields for backward compatibility.
      const messageText = (payload?.['text'] ?? payload?.['message']) as string | undefined;

      if (!messageText || typeof messageText !== 'string') {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.INVALID_PAYLOAD, message: 'Invalid message payload' });
        return;
      }

      // roomId: prefer from payload, fall back to session (frontend omits it)
      let roomId = payload?.['roomId'] as string | undefined;
      if (!roomId) {
        const session = await sessionService.getSession(data.sessionId);
        roomId = session?.roomId;
      }

      if (!roomId) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.NOT_IN_ROOM, message: 'Not in a room' });
        return;
      }

      // Validate message length
      if (messageText.length > Limits.CHAT_MESSAGE_MAX_LENGTH) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.VALIDATION_ERROR, message: `Message too long (max ${Limits.CHAT_MESSAGE_MAX_LENGTH} chars)` });
        return;
      }

      // Rate limit: max 10 messages per 10 seconds
      const limitKey = RedisKeys.rateLimit.message(data.sessionId);
      const count = await redisRateLimit.incr(limitKey);
      if (count === 1) await redisRateLimit.expire(limitKey, env.RATE_LIMIT_MSG_WINDOW_SECONDS);
      if (count > env.RATE_LIMIT_MSG_MAX) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.RATE_LIMITED, message: 'Sending messages too fast. Slow down.' });
        return;
      }

      // Verify room membership
      const isMember = await roomService.isRoomMember(roomId, data.sessionId);
      if (!isMember) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.NOT_IN_ROOM, message: 'Not in room' });
        return;
      }

      const peerSocketId = await roomService.getPeerSocketId(roomId, data.sessionId);
      if (!peerSocketId) return;

      // Relay sanitized message (strip only null bytes, allow unicode)
      const sanitizedMessage = messageText.replace(/\0/g, '').trim();
      if (!sanitizedMessage) return;

      socket.to(peerSocketId).emit(SocketEvents.CHAT_MESSAGE_INCOMING, {
        text: sanitizedMessage,
        timestamp: Date.now(),
      });

      logger.debug('Chat: message relayed', { roomId });
    } catch (err) {
      logError('Chat: message error', err);
    }
  });
}

