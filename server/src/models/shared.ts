import { Schema } from 'mongoose';

export const ROLES = ['citizen', 'volunteer', 'team_leader', 'admin', 'food_provider', 'shelter_coordinator'] as const;
export type Role = (typeof ROLES)[number];

export const EMERGENCY_TYPES = [
  'flood',
  'fire',
  'earthquake',
  'cyclone',
  'landslide',
  'medical',
  'trapped',
  'food_water',
  'shelter_needed',
  'road_hazard',
  'other',
] as const;
export type EmergencyType = (typeof EMERGENCY_TYPES)[number];

export const EMERGENCY_STATUSES = [
  'pending',
  'acknowledged',
  'assigned',
  'in_progress',
  'completion_submitted',
  'admin_verification',
  'resolved',
] as const;
export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];

export const PRIORITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'severe'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** GeoJSON Point sub-schema ([lng, lat]). */
export const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) =>
          Array.isArray(v) && v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
        message: 'invalid_coordinates',
      },
    },
  },
  { _id: false },
);

export const attachmentSchema = new Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const statusHistorySchema = new Schema(
  {
    from: { type: String },
    to: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byRole: { type: String },
    at: { type: Date, default: Date.now },
    note: { type: String, maxlength: 1000 },
  },
  { _id: false },
);

export const vulnerableSchema = new Schema(
  {
    children: { type: Boolean, default: false },
    elderly: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    pregnant: { type: Boolean, default: false },
    injured: { type: Boolean, default: false },
  },
  { _id: false },
);
