import type { Request, Response } from 'express';
import { moderationService } from '../services/moderation.service';
import { Report } from '../models/report.model';
import { Ban } from '../models/ban.model';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────
// Report Controller
// ─────────────────────────────────────────────

export class ReportController {
  /**
   * POST /api/v1/reports
   */
  async submitReport(req: Request, res: Response): Promise<void> {
    const session = (req as Request & { session: { sessionId: string; ipHash: string } }).session;
    const { reportedSessionId, roomId, reason, description } = req.body as {
      reportedSessionId: string;
      roomId: string;
      reason: string;
      description?: string;
    };

    if (!reportedSessionId || !roomId || !reason) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'reportedSessionId, roomId, reason are required' },
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const { reportId } = await moderationService.submitReport({
        reporterSessionId:   session.sessionId,
        reportedSessionId,
        reporterIpHash:      session.ipHash,
        reportedIpHash:      'unknown',
        reportedFingerprint: 'unknown',
        roomId,
        reason: reason as never,
        description,
      });

      res.status(201).json({
        success: true,
        data: { reportId },
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'RATE_LIMITED') {
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Report rate limit exceeded' },
          timestamp: Date.now(),
        });
      } else {
        throw err;
      }
    }
  }

  /**
   * GET /api/v1/reports/:reportId
   */
  async getReport(req: Request, res: Response): Promise<void> {
    const report = await Report.findById(req.params['reportId']);
    if (!report) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Report not found' },
        timestamp: Date.now(),
      });
      return;
    }
    res.json({ success: true, data: report, timestamp: Date.now() });
  }
}

// ─────────────────────────────────────────────
// Admin Controller (Moderation)
// ─────────────────────────────────────────────

export class AdminController {
  /**
   * GET /api/v1/admin/reports
   */
  async listReports(req: Request, res: Response): Promise<void> {
    const { status = 'pending', page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Report.find({ moderationStatus: status }).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Report.countDocuments({ moderationStatus: status }),
    ]);

    res.json({
      success: true,
      data: { items, total, page: pageNum, pageSize: limitNum, hasMore: skip + items.length < total },
      timestamp: Date.now(),
    });
  }

  /**
   * POST /api/v1/admin/reports/:id/action
   */
  async takeAction(req: Request, res: Response): Promise<void> {
    const { action, sessionId, ipHash, fingerprintHash, durationHours, notes } = req.body as Record<string, string>;

    await moderationService.takeAction({
      moderatorId: 'admin',
      reportId: String(req.params['id']),
      action: action as never,
      sessionId,
      ipHash,
      fingerprintHash,
      durationHours: durationHours ? parseInt(durationHours, 10) : undefined,
      notes,
    });

    res.json({ success: true, data: { message: 'Action applied' }, timestamp: Date.now() });
  }

  /**
   * GET /api/v1/admin/bans
   */
  async listBans(req: Request, res: Response): Promise<void> {
    const bans = await Ban.find({
      $or: [{ isPermanent: true }, { expiresAt: { $gt: new Date() } }],
    }).sort({ bannedAt: -1 }).limit(100);

    res.json({ success: true, data: bans, timestamp: Date.now() });
  }

  /**
   * DELETE /api/v1/admin/bans/:id
   */
  async revokeBan(req: Request, res: Response): Promise<void> {
    await Ban.findByIdAndDelete(req.params['id']);
    res.json({ success: true, data: { message: 'Ban revoked' }, timestamp: Date.now() });
  }
}

export const reportController = new ReportController();
export const adminController = new AdminController();
