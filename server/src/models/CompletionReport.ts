import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { attachmentSchema } from './shared';

export const COMPLETION_STATUSES = ['submitted', 'under_review', 'approved', 'rejected'] as const;

export interface ICompletionReport {
  _id: Types.ObjectId;
  emergency: Types.ObjectId;
  assignment?: Types.ObjectId;
  team?: Types.ObjectId;
  /** 'completion' reports drive the workflow; 'assistance' reports are informational (volunteers). */
  kind: 'completion' | 'assistance';
  submittedBy: Types.ObjectId;
  actionsPerformed: string;
  peopleAssisted: number;
  resourcesUsed: string;
  notes?: string;
  evidence: { filename: string; originalName?: string; mimeType: string; size: number; uploadedAt: Date }[];
  status: (typeof COMPLETION_STATUSES)[number];
  reviewedBy?: Types.ObjectId;
  reviewStartedAt?: Date;
  decidedAt?: Date;
  decisionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type CompletionReportDoc = HydratedDocument<ICompletionReport>;

const schema = new Schema<ICompletionReport>(
  {
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency', required: true },
    assignment: { type: Schema.Types.ObjectId, ref: 'Assignment' },
    team: { type: Schema.Types.ObjectId, ref: 'RescueTeam' },
    kind: { type: String, enum: ['completion', 'assistance'], default: 'completion' },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actionsPerformed: { type: String, required: true, trim: true, maxlength: 3000 },
    peopleAssisted: { type: Number, required: true, min: 0, max: 100000 },
    resourcesUsed: { type: String, trim: true, maxlength: 2000, default: '' },
    notes: { type: String, maxlength: 3000 },
    evidence: { type: [attachmentSchema], default: [] },
    status: { type: String, enum: COMPLETION_STATUSES, default: 'submitted' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewStartedAt: { type: Date },
    decidedAt: { type: Date },
    decisionReason: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);

schema.index({ emergency: 1, createdAt: -1 });
schema.index({ status: 1, kind: 1, createdAt: -1 });
schema.index({ submittedBy: 1 });

export const CompletionReport = model<ICompletionReport>('CompletionReport', schema);
