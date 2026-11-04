import { Schema, model, Types } from 'mongoose';

export const RESOURCE_KINDS = ['food_shortage', 'shelter_shortage', 'shelter_near_capacity'] as const;

export interface IResourceAlert {
  _id: Types.ObjectId;
  /** Deterministic key, e.g. "food:all", "shelter:all", "shelter:<shelterId>". One OPEN alert per key. */
  key: string;
  kind: (typeof RESOURCE_KINDS)[number];
  severity: 'warning' | 'critical';
  status: 'open' | 'resolved';
  required: number;
  available: number;
  shortage: number;
  unit: string;
  /** Affected locations (emergencies / shelters) so admins know where the shortage is felt. */
  locations: { kind: 'emergency' | 'shelter'; refId: string; name: string; lat?: number; lng?: number; people: number; required?: number; free?: number }[];
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  resolvedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IResourceAlert>(
  {
    key: { type: String, required: true, maxlength: 80 },
    kind: { type: String, enum: RESOURCE_KINDS, required: true },
    severity: { type: String, enum: ['warning', 'critical'], required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    required: { type: Number, required: true, min: 0 },
    available: { type: Number, required: true, min: 0 },
    shortage: { type: Number, required: true, min: 0 },
    unit: { type: String, default: 'meals' },
    locations: { type: [new Schema({ kind: String, refId: String, name: String, lat: Number, lng: Number, people: Number, required: Number, free: Number }, { _id: false })], default: [] },
    firstDetectedAt: { type: Date, default: Date.now },
    lastDetectedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true },
);
schema.index({ key: 1, status: 1 });
schema.index({ status: 1, severity: 1, lastDetectedAt: -1 });

export const ResourceAlert = model<IResourceAlert>('ResourceAlert', schema);
