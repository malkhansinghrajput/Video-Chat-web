import { Schema, model, Document, Types } from 'mongoose';
import type { ReportReason, ModerationStatus, ModerationAction } from '../types';

export interface IReport extends Document {
  reporterSessionId: string;
  reportedSessionId: string;
  roomId: string;
  reason: ReportReason;
  description?: string;
  reporterIpHash: string;
  reportedIpHash: string;
  reportedFingerprint: string;
  moderationStatus: ModerationStatus;
  moderatorId?: string;
  actionTaken?: ModerationAction;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<IReport>(
  {
    reporterSessionId:   { type: String, required: true },
    reportedSessionId:   { type: String, required: true, index: true },
    roomId:              { type: String, required: true },
    reason:              {
      type: String,
      enum: ['spam', 'nudity', 'abuse', 'underage', 'other'],
      required: true,
    },
    description:         { type: String, maxlength: 500 },
    reporterIpHash:      { type: String, required: true },
    reportedIpHash:      { type: String, required: true },
    reportedFingerprint: { type: String, required: true },
    moderationStatus:    {
      type: String,
      enum: ['pending', 'reviewed', 'actioned', 'dismissed'],
      default: 'pending',
      index: true,
    },
    moderatorId:  { type: String },
    actionTaken:  { type: String },
  },
  { timestamps: true },
);

ReportSchema.index({ reportedSessionId: 1, moderationStatus: 1 });
ReportSchema.index({ createdAt: -1 });
ReportSchema.index({ reportedFingerprint: 1, createdAt: -1 });

export const Report = model<IReport>('Report', ReportSchema);
