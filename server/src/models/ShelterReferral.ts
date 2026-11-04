import { Schema, model, Types } from 'mongoose';

export interface IShelterReferral {
  _id: Types.ObjectId;
  shelter: Types.ObjectId;
  emergency?: Types.ObjectId;
  people: number;
  /** Referral is created (approved) by an admin; the coordinator confirms arrival which updates occupancy. */
  status: 'referred' | 'admitted' | 'cancelled';
  approvedBy: Types.ObjectId;
  note?: string;
  admittedBy?: Types.ObjectId;
  admittedAt?: Date;
  createdAt: Date;
}

const schema = new Schema<IShelterReferral>(
  {
    shelter: { type: Schema.Types.ObjectId, ref: 'Shelter', required: true },
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency' },
    people: { type: Number, required: true, min: 1, max: 100000 },
    status: { type: String, enum: ['referred', 'admitted', 'cancelled'], default: 'referred' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, maxlength: 500 },
    admittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    admittedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ shelter: 1, status: 1 });
schema.index({ emergency: 1 });

export const ShelterReferral = model<IShelterReferral>('ShelterReferral', schema);
