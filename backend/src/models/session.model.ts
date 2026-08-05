import { Schema, model, Document, Types } from 'mongoose';

export interface ISession extends Document {
  sessionId: string;
  deviceFingerprint: string;
  ipHash: string;
  country: string;
  language: string;
  interests: string[];
  status: 'active' | 'banned' | 'suspended';
  reportCount: number;
  isBanned: boolean;
  bannedUntil?: Date;
  createdAt: Date;
  lastActiveAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    sessionId:         { type: String, required: true, unique: true, index: true },
    deviceFingerprint: { type: String, required: true, index: true },
    ipHash:            { type: String, required: true, index: true },
    country:           { type: String, default: 'XX' },
    language:          { type: String, default: 'en' },
    interests:         [{ type: String }],
    status:            { type: String, enum: ['active', 'banned', 'suspended'], default: 'active' },
    reportCount:       { type: Number, default: 0 },
    isBanned:          { type: Boolean, default: false },
    bannedUntil:       { type: Date },
    lastActiveAt:      { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    // Auto-expire documents after 30 days of inactivity
    expireAfterSeconds: 30 * 24 * 3600,
  },
);

// Compound index for ban lookups
SessionSchema.index({ deviceFingerprint: 1, status: 1 });
SessionSchema.index({ ipHash: 1, createdAt: -1 });
SessionSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const Session = model<ISession>('Session', SessionSchema);
