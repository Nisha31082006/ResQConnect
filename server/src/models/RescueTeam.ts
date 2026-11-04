import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { pointSchema } from './shared';

export interface IRescueTeam {
  _id: Types.ObjectId;
  name: string;
  leader: Types.ObjectId;
  skills: string[];
  capacity: number;
  availability: 'available' | 'busy' | 'offline';
  notes?: string;
  /** Last location shared by the team leader (shown only to admins and the team itself). */
  lastLocation?: { type: 'Point'; coordinates: number[] };
  lastLocationAt?: Date;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
export type RescueTeamDoc = HydratedDocument<IRescueTeam>;

const schema = new Schema<IRescueTeam>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    leader: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skills: { type: [String], default: [] },
    capacity: { type: Number, required: true, min: 1, max: 200, default: 5 },
    availability: { type: String, enum: ['available', 'busy', 'offline'], default: 'available' },
    notes: { type: String, maxlength: 1000 },
    lastLocation: { type: pointSchema },
    lastLocationAt: { type: Date },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

schema.index({ name: 1 }, { unique: true });
schema.index({ leader: 1 });
schema.index({ active: 1, availability: 1 });
schema.index({ lastLocation: '2dsphere' });

export const RescueTeam = model<IRescueTeam>('RescueTeam', schema);
