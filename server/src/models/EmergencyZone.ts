import { Schema, model, Types } from 'mongoose';
import { pointSchema } from './shared';

export const ZONE_STATUSES = ['detected', 'reviewed', 'dismissed', 'inactive'] as const;

export interface IEmergencyZone {
  _id: Types.ObjectId;
  /** Possible cluster of nearby reports. Reports are only REFERENCED - never merged, edited or deleted. */
  emergencies: Types.ObjectId[];
  center: { type: 'Point'; coordinates: number[] };
  radiusMeters: number;
  reportCount: number;
  peopleCount: number;
  sosCount: number;
  typeCounts: Record<string, number>;
  dominantType: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  firstReportAt: Date;
  lastReportAt: Date;
  status: (typeof ZONE_STATUSES)[number];
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  reviewNote?: string;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IEmergencyZone>(
  {
    emergencies: { type: [{ type: Schema.Types.ObjectId, ref: 'Emergency' }], default: [] },
    center: { type: pointSchema, required: true },
    radiusMeters: { type: Number, required: true, min: 0 },
    reportCount: { type: Number, required: true, min: 1 },
    peopleCount: { type: Number, required: true, min: 0 },
    sosCount: { type: Number, default: 0 },
    typeCounts: { type: Schema.Types.Mixed, default: {} },
    dominantType: { type: String, required: true },
    riskLevel: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'medium' },
    firstReportAt: { type: Date, required: true },
    lastReportAt: { type: Date, required: true },
    status: { type: String, enum: ZONE_STATUSES, default: 'detected' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, maxlength: 1000 },
    firstDetectedAt: { type: Date, default: Date.now },
    lastDetectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ status: 1, lastDetectedAt: -1 });
schema.index({ emergencies: 1 });

export const EmergencyZone = model<IEmergencyZone>('EmergencyZone', schema);
