import { Schema, model, Document } from 'mongoose';
import type { BanTargetType } from '../types';

export interface IBan extends Document {
  targetType: BanTargetType;
  targetHash: string;
  reason: string;
  bannedBy: string;
  bannedAt: Date;
  expiresAt?: Date;
  isPermanent: boolean;
  notes?: string;
}

const BanSchema = new Schema<IBan>(
  {
    targetType:  { type: String, enum: ['ip', 'fingerprint', 'session'], required: true },
    targetHash:  { type: String, required: true, index: true },
    reason:      { type: String, required: true },
    bannedBy:    { type: String, required: true },
    bannedAt:    { type: Date, default: Date.now },
    expiresAt:   { type: Date },
    isPermanent: { type: Boolean, default: false },
    notes:       { type: String },
  },
  { timestamps: true },
);

BanSchema.index({ targetHash: 1, expiresAt: 1 });
// TTL index: automatically remove temp bans after they expire
BanSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { isPermanent: false } });

export const Ban = model<IBan>('Ban', BanSchema);
