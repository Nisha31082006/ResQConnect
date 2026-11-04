import { Schema, model, Types, HydratedDocument } from 'mongoose';

export interface IEscalation {
  _id: Types.ObjectId;
  emergency: Types.ObjectId;
  /** 1 = first deadline missed, 2 = second, ... (bounded by settings). One record per level -> no repeated alerts. */
  level: number;
  status: 'open' | 'acknowledged' | 'resolved';
  triggeredAt: Date;
  waitedSecondsAtTrigger: number;
  deadlineSeconds: number;
  acknowledgedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  resolution?: 'emergency_acknowledged' | 'admin_resolved';
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type EscalationDoc = HydratedDocument<IEscalation>;

const schema = new Schema<IEscalation>(
  {
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency', required: true },
    level: { type: Number, required: true, min: 1, max: 10 },
    status: { type: String, enum: ['open', 'acknowledged', 'resolved'], default: 'open' },
    triggeredAt: { type: Date, required: true, default: Date.now },
    waitedSecondsAtTrigger: { type: Number, required: true },
    deadlineSeconds: { type: Number, required: true },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
    resolution: { type: String, enum: ['emergency_acknowledged', 'admin_resolved'] },
    note: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);

// The unique index is the deduplication guarantee, even with several server instances.
schema.index({ emergency: 1, level: 1 }, { unique: true });
schema.index({ status: 1, triggeredAt: -1 });

export const Escalation = model<IEscalation>('Escalation', schema);
