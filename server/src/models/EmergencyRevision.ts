import { Schema, model, Types } from 'mongoose';

export interface IEmergencyRevision {
  _id: Types.ObjectId;
  emergency: Types.ObjectId;
  revision: number;
  editedBy: Types.ObjectId;
  editorRole: string;
  /** Snapshot of changed fields: { field: { from, to } } */
  changes: Record<string, { from: unknown; to: unknown }>;
  priorityRecalculated: boolean;
  createdAt: Date;
}

const schema = new Schema<IEmergencyRevision>(
  {
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency', required: true },
    revision: { type: Number, required: true },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    editorRole: { type: String, required: true },
    changes: { type: Schema.Types.Mixed, required: true },
    priorityRecalculated: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ emergency: 1, revision: 1 }, { unique: true });

export const EmergencyRevision = model<IEmergencyRevision>('EmergencyRevision', schema);
