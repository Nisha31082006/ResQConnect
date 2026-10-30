import { Schema, model, Types, HydratedDocument } from 'mongoose';

export interface IAssignment {
  _id: Types.ObjectId;
  emergency: Types.ObjectId;
  team?: Types.ObjectId;
  /** Individual volunteers assigned directly (in addition to or instead of a team). */
  volunteers: Types.ObjectId[];
  instructions?: string;
  status: 'active' | 'reassigned' | 'completed' | 'cancelled';
  assignedBy: Types.ObjectId;
  assignedAt: Date;
  reassignedFrom?: Types.ObjectId;
  reassignReason?: string;
  endedAt?: Date;
  progress: { by: Types.ObjectId; note: string; percent?: number; at: Date }[];
  createdAt: Date;
  updatedAt: Date;
}
export type AssignmentDoc = HydratedDocument<IAssignment>;

const schema = new Schema<IAssignment>(
  {
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency', required: true },
    team: { type: Schema.Types.ObjectId, ref: 'RescueTeam' },
    volunteers: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    instructions: { type: String, maxlength: 2000 },
    status: { type: String, enum: ['active', 'reassigned', 'completed', 'cancelled'], default: 'active' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
    reassignedFrom: { type: Schema.Types.ObjectId, ref: 'Assignment' },
    reassignReason: { type: String, maxlength: 1000 },
    endedAt: { type: Date },
    progress: {
      type: [
        new Schema(
          {
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            note: { type: String, required: true, maxlength: 1000 },
            percent: { type: Number, min: 0, max: 100 },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

schema.index({ emergency: 1, status: 1 });
schema.index({ team: 1, status: 1 });
schema.index({ volunteers: 1, status: 1 });

export const Assignment = model<IAssignment>('Assignment', schema);
