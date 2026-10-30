import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { SEVERITIES, Severity, attachmentSchema, pointSchema } from './shared';

export const BLOCKAGE_TYPES = ['flooded', 'landslide', 'fallen_tree', 'collapsed_bridge', 'debris', 'damaged_road', 'other'] as const;

export interface IRoadBlockage {
  _id: Types.ObjectId;
  type: (typeof BLOCKAGE_TYPES)[number];
  description: string;
  severity: Severity;
  location: { type: 'Point'; coordinates: number[] };
  address?: string;
  photo?: { filename: string; originalName?: string; mimeType: string; size: number; uploadedAt: Date };
  reportedBy: Types.ObjectId;
  reporterRole: string;
  reportedAt: Date;
  /** Reports start as unverified and are never presented as confirmed until an admin verifies them. */
  verificationStatus: 'unverified' | 'verified' | 'rejected';
  verifiedBy?: Types.ObjectId;
  verifiedAt?: Date;
  verificationNote?: string;
  /** Clearing is only final after an admin approves a clearance report. */
  status: 'active' | 'cleared';
  clearedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
export type RoadBlockageDoc = HydratedDocument<IRoadBlockage>;

const schema = new Schema<IRoadBlockage>(
  {
    type: { type: String, enum: BLOCKAGE_TYPES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    severity: { type: String, enum: SEVERITIES, default: 'medium' },
    location: { type: pointSchema, required: true },
    address: { type: String, trim: true, maxlength: 300 },
    photo: { type: attachmentSchema },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reporterRole: { type: String, required: true },
    reportedAt: { type: Date, default: Date.now },
    verificationStatus: { type: String, enum: ['unverified', 'verified', 'rejected'], default: 'unverified' },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    verificationNote: { type: String, maxlength: 1000 },
    status: { type: String, enum: ['active', 'cleared'], default: 'active' },
    clearedAt: { type: Date },
  },
  { timestamps: true },
);

schema.index({ location: '2dsphere' });
schema.index({ status: 1, verificationStatus: 1 });
schema.index({ reportedBy: 1 });
schema.index({ reportedAt: -1 });

export const RoadBlockage = model<IRoadBlockage>('RoadBlockage', schema);
