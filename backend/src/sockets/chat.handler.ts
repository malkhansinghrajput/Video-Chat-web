import type { Server, Socket } from 'socket.io';
import { roomService } from '../services/matching.service';
import { logger, logError } from '../config/logger';
import { SocketEvents, RedisKeys, ErrorCodes, Limits } from '../constants';
import { redisRateLimit } from '../config/redis';
import { env } from '../config/env';
import type { SocketData, ChatMessagePayload } from '../types';

// ─────────────────────────────────────────────
// Chat Event Handlers
// Text chat relay with rate limiting
// ─────────────────────────────────────────────

export function handleChatEvents(socket: Socket, _io: Server): void {
  const data = socket.data as SocketData;

  socket.on(SocketEvents.CHAT_MESSAGE, async (payload: ChatMessagePayload) => {
    try {
      if (!payload?.roomId || !payload?.message) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.INVALID_PAYLOAD, message: 'Invalid message payload' });
        return;
      }

      // Validate message length
      if (payload.message.length > Limits.CHAT_MESSAGE_MAX_LENGTH) {
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
      const isMember = await roomService.isRoomMember(payload.roomId, data.sessionId);
      if (!isMember) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.NOT_IN_ROOM, message: 'Not in room' });
        return;
      }

      const peerSocketId = await roomService.getPeerSocketId(payload.roomId, data.sessionId);
      if (!peerSocketId) return;

      // Relay sanitized message (strip only null bytes, allow unicode)
      const sanitizedMessage = payload.message.replace(/\0/g, '').trim();
      if (!sanitizedMessage) return;

      socket.to(peerSocketId).emit(SocketEvents.CHAT_MESSAGE_INCOMING, {
        message: sanitizedMessage,
        roomId: payload.roomId,
        timestamp: Date.now(),
      });

      logger.debug('Chat: message relayed', { roomId: payload.roomId });
    } catch (err) {
      logError('Chat: message error', err);
    }
  });
}
