import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { attachmentSchema } from './shared';

export interface IRoadClearanceReport {
  _id: Types.ObjectId;
  blockage: Types.ObjectId;
  submittedBy: Types.ObjectId;
  note: string;
  photo?: { filename: string; originalName?: string; mimeType: string; size: number; uploadedAt: Date };
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  decisionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type RoadClearanceReportDoc = HydratedDocument<IRoadClearanceReport>;

const schema = new Schema<IRoadClearanceReport>(
  {
    blockage: { type: Schema.Types.ObjectId, ref: 'RoadBlockage', required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, required: true, trim: true, maxlength: 2000 },
    photo: { type: attachmentSchema },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    decisionReason: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);

schema.index({ blockage: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: -1 });

export const RoadClearanceReport = model<IRoadClearanceReport>('RoadClearanceReport', schema);
