import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { ROLES, Role, pointSchema } from './shared';

export const USER_STATUSES = ['active', 'pending', 'suspended'] as const;
export const AVAILABILITY = ['available', 'busy', 'unavailable'] as const;

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: Role;
  status: (typeof USER_STATUSES)[number];
  preferredLanguage: 'en' | 'ta';
  /** Volunteer / team-leader profile */
  skills: string[];
  availability: (typeof AVAILABILITY)[number];
  /** Volunteer base / last known location (GeoJSON [lng,lat]) used for distance-based team recommendations. */
  homeLocation?: { type: 'Point'; coordinates: number[] };
  locationUpdatedAt?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
export type UserDoc = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 20 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'citizen' },
    status: { type: String, enum: USER_STATUSES, default: 'active' },
    preferredLanguage: { type: String, enum: ['en', 'ta'], default: 'en' },
    skills: { type: [String], default: [] },
    availability: { type: String, enum: AVAILABILITY, default: 'available' },
    homeLocation: { type: pointSchema },
    locationUpdatedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ role: 1, availability: 1 });

export const User = model<IUser>('User', userSchema);
