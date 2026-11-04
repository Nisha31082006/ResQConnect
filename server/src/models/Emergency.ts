import { Schema, model, Types, HydratedDocument } from 'mongoose';
import {
  EMERGENCY_STATUSES,
  EMERGENCY_TYPES,
  EmergencyStatus,
  EmergencyType,
  PRIORITY_LEVELS,
  PriorityLevel,
  SEVERITIES,
  Severity,
  attachmentSchema,
  pointSchema,
  statusHistorySchema,
  vulnerableSchema,
} from './shared';

export const DUPLICATE_REVIEW = ['pending', 'related', 'confirmed_duplicate', 'not_duplicate'] as const;

export interface IReason {
  code: string;
  points: number;
  params?: Record<string, unknown>;
}

export interface IEmergency {
  _id: Types.ObjectId;
  emergencyId: string;
  kind: 'normal' | 'sos';
  source: 'web' | 'offline_sync' | 'sms' | 'admin';
  clientRequestId?: string;
  type: EmergencyType;
  description: string;
  affectedCount: number;
  dangerToLife: boolean;
  severity: Severity;
  vulnerable: { children: boolean; elderly: boolean; disabled: boolean; pregnant: boolean; injured: boolean };
  assistanceNeeds: string[];
  /** Priority the citizen selected in the form (kept as-is; never used for sorting). */
  citizenPriority?: PriorityLevel;
  /** Number of people reported as trapped. */
  trappedCount: number;
  /** Admin-confirmed shelter (a referral was created; nobody is registered until the coordinator admits them). */
  shelterPlan?: { shelter: Types.ObjectId; referral?: Types.ObjectId; people: number; confirmedBy: Types.ObjectId; confirmedAt: Date };
  contact: { name?: string; phone?: string };
  location: { type: 'Point'; coordinates: number[] };
  address?: string;
  occurredAt: Date;
  evidence: { filename: string; originalName?: string; mimeType: string; size: number; uploadedAt: Date }[];
  reporter?: Types.ObjectId;
  status: EmergencyStatus;
  statusHistory: { from?: string; to: string; by?: Types.ObjectId; byRole?: string; at: Date; note?: string }[];
  acknowledgedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  resolvedAt?: Date;
  recommendedPriority: { level: PriorityLevel; score: number; reasons: IReason[]; computedAt: Date };
  finalPriority?: {
    level: PriorityLevel;
    decidedBy: Types.ObjectId;
    decidedAt: Date;
    overridden: boolean;
    overrideReason?: string;
    recommendedLevelAtDecision: PriorityLevel;
  };
  priorityReviewNeeded: boolean;
  priorityRank: number;
  requiredVolunteers: number;
  requiredSkills: string[];
  duplicateOf?: Types.ObjectId;
  duplicateCandidates: {
    emergency: Types.ObjectId;
    score: number;
    reasons: IReason[];
    distanceMeters: number;
    similarity: number;
    reviewStatus: (typeof DUPLICATE_REVIEW)[number];
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    note?: string;
    detectedAt: Date;
  }[];
  revisionCount: number;
  sms: { prepared: boolean; preparedAt?: Date; note?: string };
  createdAt: Date;
  updatedAt: Date;
}
export type EmergencyDoc = HydratedDocument<IEmergency>;

const reasonSchema = new Schema({ code: String, points: Number, params: Schema.Types.Mixed }, { _id: false });

const emergencySchema = new Schema<IEmergency>(
  {
    emergencyId: { type: String, required: true },
    kind: { type: String, enum: ['normal', 'sos'], required: true, default: 'normal' },
    source: { type: String, enum: ['web', 'offline_sync', 'sms', 'admin'], default: 'web' },
    clientRequestId: { type: String, maxlength: 80 },
    type: { type: String, enum: EMERGENCY_TYPES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    affectedCount: { type: Number, required: true, min: 1, max: 100000, default: 1 },
    dangerToLife: { type: Boolean, default: false },
    severity: { type: String, enum: SEVERITIES, default: 'medium' },
    vulnerable: { type: vulnerableSchema, default: () => ({}) },
    assistanceNeeds: { type: [String], default: [] },
    citizenPriority: { type: String, enum: PRIORITY_LEVELS },
    trappedCount: { type: Number, default: 0, min: 0, max: 100000 },
    shelterPlan: {
      shelter: { type: Schema.Types.ObjectId, ref: 'Shelter' },
      referral: { type: Schema.Types.ObjectId, ref: 'ShelterReferral' },
      people: Number,
      confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      confirmedAt: Date,
    },
    contact: { name: { type: String, trim: true, maxlength: 120 }, phone: { type: String, trim: true, maxlength: 20 } },
    location: { type: pointSchema, required: true },
    address: { type: String, trim: true, maxlength: 300 },
    occurredAt: { type: Date, required: true, default: Date.now },
    evidence: { type: [attachmentSchema], default: [] },
    reporter: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: EMERGENCY_STATUSES, default: 'pending', required: true },
    statusHistory: { type: [statusHistorySchema], default: [] },
    acknowledgedAt: { type: Date },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    recommendedPriority: {
      level: { type: String, enum: PRIORITY_LEVELS, required: true },
      score: { type: Number, required: true },
      reasons: { type: [reasonSchema], default: [] },
      computedAt: { type: Date, default: Date.now },
    },
    finalPriority: {
      level: { type: String, enum: PRIORITY_LEVELS },
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      decidedAt: { type: Date },
      overridden: { type: Boolean },
      overrideReason: { type: String, maxlength: 1000 },
      recommendedLevelAtDecision: { type: String, enum: PRIORITY_LEVELS },
    },
    priorityReviewNeeded: { type: Boolean, default: false },
    /** Derived (pre-save): numeric rank of the effective priority, used for sorting and filtering. */
    priorityRank: { type: Number, default: 1 },
    requiredVolunteers: { type: Number, default: 0, min: 0, max: 1000 },
    requiredSkills: { type: [String], default: [] },
    duplicateOf: { type: Schema.Types.ObjectId, ref: 'Emergency' },
    duplicateCandidates: {
      type: [
        new Schema(
          {
            emergency: { type: Schema.Types.ObjectId, ref: 'Emergency', required: true },
            score: Number,
            reasons: { type: [reasonSchema], default: [] },
            distanceMeters: Number,
            similarity: Number,
            reviewStatus: { type: String, enum: DUPLICATE_REVIEW, default: 'pending' },
            reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            reviewedAt: Date,
            note: { type: String, maxlength: 1000 },
            detectedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    revisionCount: { type: Number, default: 0 },
    sms: {
      prepared: { type: Boolean, default: false },
      preparedAt: { type: Date },
      note: { type: String, maxlength: 500 },
    },
  },
  { timestamps: true },
);

const RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
emergencySchema.pre('save', function (next) {
  const level = this.finalPriority?.level ?? this.recommendedPriority?.level;
  this.priorityRank = RANK[level as string] ?? 1;
  next();
});

emergencySchema.index({ emergencyId: 1 }, { unique: true });
emergencySchema.index({ priorityRank: -1, createdAt: -1 });
// Idempotency: one emergency per client-generated request id (only enforced when present).
emergencySchema.index({ clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } });
emergencySchema.index({ status: 1, createdAt: -1 });
emergencySchema.index({ kind: 1, status: 1, acknowledgedAt: 1, createdAt: 1 });
emergencySchema.index({ 'recommendedPriority.level': 1 });
emergencySchema.index({ 'finalPriority.level': 1 });
emergencySchema.index({ reporter: 1, createdAt: -1 });
emergencySchema.index({ type: 1 });
emergencySchema.index({ location: '2dsphere' });

export const Emergency = model<IEmergency>('Emergency', emergencySchema);
