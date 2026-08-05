import type { Request, Response } from 'express';
import { sessionService } from '../services/session.service';
import { getIpHash, detectCountry } from '../utils/geo.util';
import { hashSensitiveData } from '../utils/token.util';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────
// Session Controller
// ─────────────────────────────────────────────

export class SessionController {
  /**
   * POST /api/v1/session/init
   * Creates a new anonymous session.
   */
  async init(req: Request, res: Response): Promise<void> {
    const { deviceFingerprint, language = 'en', interests = [] } = req.body as {
      deviceFingerprint: string;
      language?: string;
      interests?: string[];
    };

    if (!deviceFingerprint || typeof deviceFingerprint !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'deviceFingerprint is required' },
        timestamp: Date.now(),
      });
      return;
    }

    const ipHash = getIpHash(req);
    const country = detectCountry(req);

    // Check if banned before creating session
    const fingerprintHash = hashSensitiveData(deviceFingerprint);
    const banCheck = await sessionService.isBanned({
      sessionId: 'pre-session',
      ipHash,
      fingerprintHash,
    });

    if (banCheck.banned) {
      res.status(403).json({
        success: false,
        error: { code: 'SESSION_BANNED', message: 'Access denied' },
        timestamp: Date.now(),
      });
      return;
    }

    const { sessionId, token } = await sessionService.createSession({
      deviceFingerprint,
      ipHash,
      country,
      language: String(language).slice(0, 10),
      interests: Array.isArray(interests)
        ? interests.slice(0, 10).map((t) => String(t).slice(0, 30))
        : [],
    });

    res.status(201).json({
      success: true,
      data: { sessionId, token, country, expiresIn: env.SESSION_TTL_SECONDS },
      timestamp: Date.now(),
    });

    logger.info('SessionController: session initialized', { sessionId, country });
  }

  /**
   * GET /api/v1/session/validate
   * Validates a session token.
   */
  async validate(req: Request, res: Response): Promise<void> {
    const session = await sessionService.validateToken(
      req.headers['x-session-token'] as string,
    );

    if (!session) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_SESSION', message: 'Invalid or expired session' },
        timestamp: Date.now(),
      });
      return;
    }

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        status: session.status,
        country: session.country,
        isBanned: session.isBanned,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * GET /api/v1/session/iceservers
   * Returns dynamic TURN/STUN credentials for the requesting session.
   */
  async getIceServers(req: Request, res: Response): Promise<void> {
    const session = (req as Request & { session: { sessionId: string } }).session;
    const credentials = sessionService.getTurnCredentials(session.sessionId);

    res.json({
      success: true,
      data: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          {
            urls: credentials.urls,
            username: credentials.username,
            credential: credentials.credential,
          },
        ],
        ttl: credentials.ttl,
      },
      timestamp: Date.now(),
    });
  }
}

export const sessionController = new SessionController();
