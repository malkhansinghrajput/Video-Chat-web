import { Schema, model, Document } from 'mongoose';

export interface IBlock extends Document {
  blockerSessionId: string;
  blockedFingerprint: string;
  createdAt: Date;
}

const BlockSchema = new Schema<IBlock>(
  {
    blockerSessionId:    { type: String, required: true, index: true },
    blockedFingerprint:  { type: String, required: true },
    createdAt:           { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// Auto-expire blocks after 7 days
BlockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
BlockSchema.index({ blockerSessionId: 1, blockedFingerprint: 1 }, { unique: true });

export const Block = model<IBlock>('Block', BlockSchema);
