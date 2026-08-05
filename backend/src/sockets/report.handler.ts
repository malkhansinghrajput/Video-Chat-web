import type { Server, Socket } from 'socket.io';
import { sessionService } from '../services/session.service';
import { moderationService } from '../services/moderation.service';
import { logger, logError } from '../config/logger';
import { SocketEvents, ErrorCodes } from '../constants';
import type { SocketData, ReportPayload } from '../types';
import { hashSensitiveData } from '../utils/token.util';

// ─────────────────────────────────────────────
// Report Event Handlers
// ─────────────────────────────────────────────

export function handleReportEvents(socket: Socket, _io: Server): void {
  const data = socket.data as SocketData;

  socket.on(SocketEvents.REPORT_SUBMIT, async (payload: ReportPayload) => {
    try {
      if (!payload?.roomId || !payload?.reason) {
        socket.emit(SocketEvents.SESSION_ERROR, {
          code: ErrorCodes.INVALID_PAYLOAD,
          message: 'Invalid report payload',
        });
        return;
      }

      const validReasons = ['spam', 'nudity', 'abuse', 'underage', 'other'];
      if (!validReasons.includes(payload.reason)) {
        socket.emit(SocketEvents.SESSION_ERROR, {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid report reason',
        });
        return;
      }

      // Get reporter and peer session
      const session = await sessionService.getSession(data.sessionId);
      if (!session?.peerId) {
        socket.emit(SocketEvents.SESSION_ERROR, {
          code: ErrorCodes.NOT_IN_ROOM,
          message: 'No active peer to report',
        });
        return;
      }

      const peerSession = await sessionService.getSession(session.peerId);

      const { reportId, autoActioned } = await moderationService.submitReport({
        reporterSessionId:   data.sessionId,
        reportedSessionId:   session.peerId,
        reporterIpHash:      data.ipHash,
        reportedIpHash:      peerSession?.ipHash ?? 'unknown',
        reportedFingerprint: peerSession?.deviceFingerprint ?? 'unknown',
        roomId:              payload.roomId,
        reason:              payload.reason,
        description:         payload.description?.slice(0, 500),
      });

      // If auto-banned, notify peer
      if (autoActioned && peerSession?.socketId) {
        socket.to(peerSession.socketId).emit(SocketEvents.SESSION_BANNED, {
          reason: 'Removed due to reports',
          isPermanent: false,
        });
      }

      // Acknowledge to reporter (don't leak auto-ban info)
      socket.emit('report:submitted', { reportId });

      logger.info('ReportHandler: report submitted', {
        reportId,
        reason: payload.reason,
        autoActioned,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'RATE_LIMITED') {
        socket.emit(SocketEvents.SESSION_ERROR, {
          code: ErrorCodes.RATE_LIMITED,
          message: 'Report rate limit exceeded',
        });
      } else {
        logError('ReportHandler: error', err);
        socket.emit(SocketEvents.SESSION_ERROR, {
          code: ErrorCodes.INTERNAL_ERROR,
          message: 'Failed to submit report',
        });
      }
    }
  });
}
