import { Schema, model, Types } from 'mongoose';

export interface INotification {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** Stable key the client translates, e.g. "sos_created". */
  type: string;
  params: Record<string, unknown>;
  /** English fallback text (the client prefers the translated `type`). */
  message: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
}

const schema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    message: { type: String, required: true, maxlength: 500 },
    link: { type: String, maxlength: 300 },
    entityType: { type: String },
    entityId: { type: String },
    read: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ user: 1, read: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', schema);
