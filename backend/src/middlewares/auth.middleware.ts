import type { Request, Response, NextFunction } from 'express';
import { sessionService } from '../services/session.service';
import { hashSensitiveData } from '../utils/token.util';
import { logger } from '../config/logger';
import { ErrorCodes } from '../constants';

/**
 * Validates the X-Session-Token header on protected routes.
 * Attaches the session to req.session on success.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers['x-session-token'] as string | undefined;

  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: ErrorCodes.INVALID_SESSION, message: 'Session token required' },
      timestamp: Date.now(),
    });
    return;
  }

  const session = await sessionService.validateToken(token);
  if (!session) {
    res.status(401).json({
      success: false,
      error: { code: ErrorCodes.SESSION_EXPIRED, message: 'Invalid or expired session token' },
      timestamp: Date.now(),
    });
    return;
  }

  if (session.isBanned) {
    res.status(403).json({
      success: false,
      error: { code: ErrorCodes.SESSION_BANNED, message: 'Session is banned' },
      timestamp: Date.now(),
    });
    return;
  }

  // Attach session to request
  (req as Request & { session: typeof session }).session = session;
  next();
}

/**
 * Socket.IO auth middleware.
 * Validates session token on socket handshake.
 */
export async function socketAuthMiddleware(
  socket: import('socket.io').Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const token =
      (socket.handshake.auth['token'] as string) ??
      (socket.handshake.headers['x-session-token'] as string);

    if (!token) {
      next(new Error('AUTH_REQUIRED'));
      return;
    }

    const session = await sessionService.validateToken(token);
    if (!session) {
      next(new Error('AUTH_INVALID'));
      return;
    }

    if (session.isBanned) {
      next(new Error('AUTH_BANNED'));
      return;
    }

    // Attach session data to socket
    socket.data = {
      sessionId:         session.sessionId,
      deviceFingerprint: session.deviceFingerprint,
      country:           session.country,
      language:          session.language,
      interests:         session.interests,
      ipHash:            session.ipHash,
    };

    next();
  } catch (err) {
    logger.error('socketAuthMiddleware: error', { error: String(err) });
    next(new Error('AUTH_ERROR'));
  }
}
