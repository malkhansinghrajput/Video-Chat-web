import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import { sessionService } from '../services/session.service';
import { logger } from '../config/logger';
import { ErrorCodes } from '../constants';
import { env } from '../config/env';
import type { SocketData } from '../types';

/**
 * Validates the X-Session-Token header on protected Express routes.
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

  (req as Request & { session: typeof session }).session = session;
  next();
}

/**
 * Socket.IO authentication middleware.
 * Verifies handshake auth token or header before allowing socket connection.
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  const token = (socket.handshake.auth?.['token'] || socket.handshake.headers['x-session-token']) as string | undefined;

  if (!token) {
    next(new Error('Authentication token required'));
    return;
  }

  try {
    const session = await sessionService.validateToken(token);
    if (!session) {
      next(new Error('Invalid or expired session token'));
      return;
    }
    if (session.isBanned) {
      next(new Error('Session is banned'));
      return;
    }

    const data = socket.data as SocketData;
    data.sessionId = session.sessionId;
    data.country   = session.country;
    data.language  = session.language;
    data.interests = session.interests;
    next();
  } catch (err) {
    logger.warn('Socket auth failed', { error: String(err) });
    next(new Error('Internal authentication error'));
  }
}

/**
 * Admin authentication middleware.
 * Verifies X-Admin-Token header matches ADMIN_SECRET_TOKEN in env.
 */
export function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const adminToken = req.headers['x-admin-token'] as string | undefined;

  if (!adminToken || adminToken !== env.ADMIN_API_TOKEN) {
    res.status(403).json({
      success: false,
      error: { code: ErrorCodes.INVALID_SESSION, message: 'Admin authorization failed' },
      timestamp: Date.now(),
    });
    return;
  }

  next();
}
