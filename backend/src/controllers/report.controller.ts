import type { Request, Response } from 'express';
import { moderationService } from '../services/moderation.service';
import { Report } from '../models/report.model';
import { Ban } from '../models/ban.model';

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
    const reportId = req.params['reportId'] as string;
    const report = await Report.findById(reportId);
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

  /**
   * GET /api/v1/admin/reports
   */
  async listReports(req: Request, res: Response): Promise<void> {
    const status = req.query['status'] as string | undefined;
    const query  = status ? { status } : {};
    const reports = await Report.find(query).sort({ createdAt: -1 }).limit(100);

    res.json({ success: true, data: reports, timestamp: Date.now() });
  }

  /**
   * POST /api/v1/admin/reports/:id/action
   */
  async actionReport(req: Request, res: Response): Promise<void> {
    const reportId = req.params['id'] as string;
    const { action, banDurationHours, notes } = req.body as {
      action: 'ban_temp' | 'ban_perm' | 'dismiss';
      banDurationHours?: number;
      notes?: string;
    };

    const adminId = 'admin'; // In production, extract from admin token
    await moderationService.takeAction({
      moderatorId: adminId,
      reportId,
      action: action as never,
      durationHours: banDurationHours,
      notes,
    });

    res.json({ success: true, data: { message: 'Action applied' }, timestamp: Date.now() });
  }

  /**
   * GET /api/v1/admin/bans
   */
  async listBans(_req: Request, res: Response): Promise<void> {
    const bans = await Ban.find({
      $or: [{ isPermanent: true }, { expiresAt: { $gt: new Date() } }],
    }).sort({ bannedAt: -1 }).limit(100);

    res.json({ success: true, data: bans, timestamp: Date.now() });
  }

  /**
   * DELETE /api/v1/admin/bans/:id
   */
  async liftBan(req: Request, res: Response): Promise<void> {
    const banId = req.params['id'] as string;
    await Ban.findByIdAndDelete(banId);

    res.json({ success: true, data: { message: 'Ban lifted' }, timestamp: Date.now() });
  }
}

export const reportController = new ReportController();
