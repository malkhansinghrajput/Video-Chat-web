import type { Server, Socket } from 'socket.io';
import { roomService } from '../services/matching.service';
import { logger, logError } from '../config/logger';
import { SocketEvents, ErrorCodes } from '../constants';
import { redisSessions } from '../config/redis';
import type { SocketData, WebRtcOfferPayload, WebRtcAnswerPayload, WebRtcIceCandidatePayload } from '../types';

// ─────────────────────────────────────────────
// WebRTC Signaling Handlers
// Pure relay — server never reads SDP/ICE content
// ─────────────────────────────────────────────

export function handleSignalingEvents(socket: Socket, _io: Server): void {
  const data = socket.data as SocketData;

  // ── webrtc:offer ─────────────────────────
  socket.on(SocketEvents.WEBRTC_OFFER, async (payload: WebRtcOfferPayload) => {
    try {
      if (!payload?.roomId || !payload?.sdp) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.INVALID_PAYLOAD, message: 'Invalid offer payload' });
        return;
      }

      const isMember = await roomService.isRoomMember(payload.roomId, data.sessionId);
      if (!isMember) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.NOT_IN_ROOM, message: 'Not a room member' });
        return;
      }

      const peerSocketId = await roomService.getPeerSocketId(payload.roomId, data.sessionId);
      if (!peerSocketId) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.ROOM_NOT_FOUND, message: 'Peer not found' });
        return;
      }

      socket.to(peerSocketId).emit(SocketEvents.WEBRTC_OFFER, {
        sdp: payload.sdp,
        roomId: payload.roomId,
      });

      logger.debug('Signaling: offer relayed', { roomId: payload.roomId });
    } catch (err) {
      logError('Signaling: offer error', err);
    }
  });

  // ── webrtc:answer ────────────────────────
  socket.on(SocketEvents.WEBRTC_ANSWER, async (payload: WebRtcAnswerPayload) => {
    try {
      if (!payload?.roomId || !payload?.sdp) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.INVALID_PAYLOAD, message: 'Invalid answer payload' });
        return;
      }

      const isMember = await roomService.isRoomMember(payload.roomId, data.sessionId);
      if (!isMember) {
        socket.emit(SocketEvents.SESSION_ERROR, { code: ErrorCodes.NOT_IN_ROOM, message: 'Not a room member' });
        return;
      }

      const peerSocketId = await roomService.getPeerSocketId(payload.roomId, data.sessionId);
      if (!peerSocketId) return;

      socket.to(peerSocketId).emit(SocketEvents.WEBRTC_ANSWER, {
        sdp: payload.sdp,
        roomId: payload.roomId,
      });

      logger.debug('Signaling: answer relayed', { roomId: payload.roomId });
    } catch (err) {
      logError('Signaling: answer error', err);
    }
  });

  // ── webrtc:ice_candidate ─────────────────
  socket.on(SocketEvents.WEBRTC_ICE_CANDIDATE, async (payload: WebRtcIceCandidatePayload) => {
    try {
      if (!payload?.roomId || !payload?.candidate) {
        return; // silently drop invalid ICE candidates
      }

      const isMember = await roomService.isRoomMember(payload.roomId, data.sessionId);
      if (!isMember) return;

      const peerSocketId = await roomService.getPeerSocketId(payload.roomId, data.sessionId);
      if (!peerSocketId) return;

      socket.to(peerSocketId).emit(SocketEvents.WEBRTC_ICE_CANDIDATE, {
        candidate: payload.candidate,
        roomId: payload.roomId,
      });
    } catch (err) {
      logError('Signaling: ICE candidate error', err);
    }
  });
}
