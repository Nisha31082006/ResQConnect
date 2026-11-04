import { Schema, model, Types } from 'mongoose';

export interface ITeamMembership {
  _id: Types.ObjectId;
  team: Types.ObjectId;
  user: Types.ObjectId;
  role: 'leader' | 'member';
  active: boolean;
  joinedAt: Date;
  leftAt?: Date;
  addedBy: Types.ObjectId;
}

const schema = new Schema<ITeamMembership>({
  team: { type: Schema.Types.ObjectId, ref: 'RescueTeam', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['leader', 'member'], default: 'member' },
  active: { type: Boolean, default: true },
  joinedAt: { type: Date, default: Date.now },
  leftAt: { type: Date },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});

schema.index({ team: 1, user: 1 }, { unique: true });
schema.index({ user: 1, active: 1 });
schema.index({ team: 1, active: 1 });

export const TeamMembership = model<ITeamMembership>('TeamMembership', schema);
