import { Schema, model, Types } from 'mongoose';

export interface ISetting {
  _id: Types.ObjectId;
  key: string;
  value: Record<string, unknown>;
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
}

const schema = new Schema<ISetting>(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

schema.index({ key: 1 }, { unique: true });

export const Setting = model<ISetting>('Setting', schema);
