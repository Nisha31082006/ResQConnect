import { Schema, model, Types } from 'mongoose';

export const FOLLOW_UP_KINDS = ['emergency_update', 'rescue_progress', 'shelter_occupancy'] as const;

export interface IFollowUp {
  _id: Types.ObjectId;
  /** e.g. "emergency_update:<id>", "rescue_progress:<assignmentId>", "shelter_occupancy:<shelterId>" - one OPEN follow-up per key. */
  key: string;
  kind: (typeof FOLLOW_UP_KINDS)[number];
  status: 'open' | 'completed' | 'dismissed';
  emergency?: Types.ObjectId;
  assignment?: Types.ObjectId;
  shelter?: Types.ObjectId;
  /** Who is being reminded (team leader / shelter coordinator). Admins are always notified as well. */
  assignees: Types.ObjectId[];
  label: string;
  idleMinutes: number;
  reminderCount: number;
  lastRemindedAt?: Date;
  completedAt?: Date;
  completionReason?: 'updated' | 'resolved' | 'admin_dismissed';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IFollowUp>(
  {
    key: { type: String, required: true, maxlength: 100 },
    kind: { type: String, enum: FOLLOW_UP_KINDS, required: true },
    status: { type: String, enum: ['open', 'completed', 'dismissed'], default: 'open' },
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency' },
    assignment: { type: Schema.Types.ObjectId, ref: 'Assignment' },
    shelter: { type: Schema.Types.ObjectId, ref: 'Shelter' },
    assignees: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    label: { type: String, default: '' },
    idleMinutes: { type: Number, default: 0 },
    reminderCount: { type: Number, default: 0 },
    lastRemindedAt: { type: Date },
    completedAt: { type: Date },
    completionReason: { type: String, enum: ['updated', 'resolved', 'admin_dismissed'] },
  },
  { timestamps: true },
);
schema.index({ key: 1, status: 1 });
schema.index({ status: 1, kind: 1, createdAt: -1 });

export const FollowUp = model<IFollowUp>('FollowUp', schema);
