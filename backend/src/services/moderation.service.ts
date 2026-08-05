import { Report } from '../models/report.model';
import { Ban } from '../models/ban.model';
import { Session } from '../models/session.model';
import { redisSessions, redisRateLimit } from '../config/redis';
import { RedisKeys, Limits } from '../constants';
import { logger, logError } from '../config/logger';
import { env } from '../config/env';
import { hashSensitiveData } from '../utils/token.util';
import type { ReportReason, ModerationAction } from '../types';

// ─────────────────────────────────────────────
// Moderation Service
// ─────────────────────────────────────────────

export class ModerationService {
  /**
   * Submit a report against a peer.
   * Automatically checks rate limits and triggers auto-ban if threshold exceeded.
   */
  async submitReport(params: {
    reporterSessionId: string;
    reportedSessionId: string;
    reporterIpHash: string;
    reportedIpHash: string;
    reportedFingerprint: string;
    roomId: string;
    reason: ReportReason;
    description?: string;
  }): Promise<{ reportId: string; autoActioned: boolean }> {
    // Check reporter rate limit
    const limitKey = RedisKeys.rateLimit.report(params.reporterSessionId);
    const count = await redisRateLimit.incr(limitKey);
    if (count === 1) {
      await redisRateLimit.expire(limitKey, env.RATE_LIMIT_REPORT_WINDOW_HOURS * 3600);
    }
    if (count > env.RATE_LIMIT_REPORT_MAX) {
      throw Object.assign(new Error('Report rate limit exceeded'), { code: 'RATE_LIMITED' });
    }

    const fingerprintHash = hashSensitiveData(params.reportedFingerprint);

    const report = await Report.create({
      reporterSessionId:   params.reporterSessionId,
      reportedSessionId:   params.reportedSessionId,
      roomId:              params.roomId,
      reason:              params.reason,
      description:         params.description,
      reporterIpHash:      params.reporterIpHash,
      reportedIpHash:      params.reportedIpHash,
      reportedFingerprint: fingerprintHash,
    });

    // Increment reported session's report counter in Redis
    const reportCountKey = `reportcount:${params.reportedSessionId}`;
    const reportCount = await redisRateLimit.incr(reportCountKey);
    if (reportCount === 1) {
      await redisRateLimit.expire(reportCountKey, Limits.AUTO_BAN_WINDOW_MINUTES * 60);
    }

    // Auto-ban check
    let autoActioned = false;
    if (reportCount >= Limits.AUTO_BAN_REPORT_THRESHOLD) {
      await this.applyAutoBan(params.reportedSessionId, params.reportedIpHash, fingerprintHash);
      autoActioned = true;
      logger.warn('ModerationService: auto-ban triggered', {
        sessionId: params.reportedSessionId,
        reportCount,
      });
    }

    // Update MongoDB session report count
    await Session.updateOne(
      { sessionId: params.reportedSessionId },
      { $inc: { reportCount: 1 } },
    ).catch((err) => logError('ModerationService: failed to update session report count', err));

    logger.info('ModerationService: report submitted', {
      reportId: String(report._id),
      reason: params.reason,
      autoActioned,
    });

    return { reportId: String(report._id), autoActioned };
  }

  /**
   * Block a user by fingerprint.
   */
  async blockUser(blockerSessionId: string, blockedFingerprint: string): Promise<void> {
    const { Block } = await import('../models/block.model');
    const hash = hashSensitiveData(blockedFingerprint);

    await Block.findOneAndUpdate(
      { blockerSessionId, blockedFingerprint: hash },
      { blockerSessionId, blockedFingerprint: hash },
      { upsert: true },
    );

    // Cache in Redis for fast matching-engine lookup (7 days TTL)
    await redisSessions.setex(`block:${blockerSessionId}:${hash}`, 7 * 24 * 3600, '1');
    logger.debug('ModerationService: user blocked', { blockerSessionId });
  }

  /**
   * Check if two sessions/fingerprints are blocked from each other.
   */
  async areBlocked(sessionIdA: string, fingerprintA: string, fingerprintB: string): Promise<boolean> {
    const hashA = hashSensitiveData(fingerprintA);
    const hashB = hashSensitiveData(fingerprintB);

    const [blockAB, blockBA] = await Promise.all([
      redisSessions.exists(`block:${sessionIdA}:${hashB}`),
      redisSessions.exists(`block:${fingerprintB}:${hashA}`),
    ]);

    return blockAB === 1 || blockBA === 1;
  }

  /**
   * Apply an auto-ban (threshold-based).
   */
  private async applyAutoBan(
    sessionId: string,
    ipHash: string,
    fingerprintHash: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + Limits.AUTO_BAN_DURATION_HOURS * 3600 * 1000);

    await Ban.create([
      { targetType: 'session',     targetHash: sessionId,       reason: 'auto_ban_threshold', bannedBy: 'system', expiresAt },
      { targetType: 'ip',          targetHash: ipHash,          reason: 'auto_ban_threshold', bannedBy: 'system', expiresAt },
      { targetType: 'fingerprint', targetHash: fingerprintHash, reason: 'auto_ban_threshold', bannedBy: 'system', expiresAt },
    ]);

    // Cache ban in Redis for fast session validation (ban TTL)
    const banData = JSON.stringify({ reason: 'auto_ban_threshold', until: expiresAt.getTime() });
    const ttlSeconds = Limits.AUTO_BAN_DURATION_HOURS * 3600;
    await Promise.all([
      redisSessions.setex(RedisKeys.ban(sessionId), ttlSeconds, banData),
      redisSessions.setex(RedisKeys.ban(ipHash), ttlSeconds, banData),
      redisSessions.setex(RedisKeys.ban(fingerprintHash), ttlSeconds, banData),
    ]);

    // Update session status in MongoDB
    await Session.updateOne({ sessionId }, { $set: { isBanned: true, bannedUntil: expiresAt, status: 'banned' } })
      .catch((err) => logError('ModerationService: failed to update session ban status', err));
  }

  /**
   * Manual moderation action by admin.
   */
  async takeAction(params: {
    moderatorId: string;
    reportId: string;
    action: ModerationAction;
    sessionId?: string;
    ipHash?: string;
    fingerprintHash?: string;
    durationHours?: number;
    notes?: string;
  }): Promise<void> {
    // Update report status
    await Report.findByIdAndUpdate(params.reportId, {
      moderationStatus: params.action === 'dismiss' ? 'dismissed' : 'actioned',
      moderatorId: params.moderatorId,
      actionTaken: params.action,
    });

    if (params.action === 'ban_temp' || params.action === 'ban_perm') {
      const isPermanent = params.action === 'ban_perm';
      const expiresAt = isPermanent
        ? undefined
        : new Date(Date.now() + (params.durationHours ?? 24) * 3600 * 1000);

      const banDocs = [];
      if (params.sessionId) {
        banDocs.push({ targetType: 'session',     targetHash: params.sessionId,       reason: 'manual_ban', bannedBy: params.moderatorId, expiresAt, isPermanent, notes: params.notes });
      }
      if (params.ipHash) {
        banDocs.push({ targetType: 'ip',          targetHash: params.ipHash,          reason: 'manual_ban', bannedBy: params.moderatorId, expiresAt, isPermanent, notes: params.notes });
      }
      if (params.fingerprintHash) {
        banDocs.push({ targetType: 'fingerprint', targetHash: params.fingerprintHash, reason: 'manual_ban', bannedBy: params.moderatorId, expiresAt, isPermanent, notes: params.notes });
      }

      if (banDocs.length) await Ban.create(banDocs);
    }

    logger.info('ModerationService: action taken', {
      moderatorId: params.moderatorId,
      action: params.action,
      reportId: params.reportId,
    });
  }
}

export const moderationService = new ModerationService();
