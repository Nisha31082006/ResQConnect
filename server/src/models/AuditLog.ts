import { Schema, model, Types } from 'mongoose';

export interface IAuditLog {
  _id: Types.ObjectId;
  actor?: Types.ObjectId;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  details: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const schema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    details: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });
schema.index({ actor: 1, createdAt: -1 });
schema.index({ entityType: 1, entityId: 1 });

export const AuditLog = model<IAuditLog>('AuditLog', schema);
