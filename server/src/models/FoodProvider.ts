import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { pointSchema } from './shared';

export interface IFoodProvider {
  _id: Types.ObjectId;
  name: string;
  owner: Types.ObjectId;
  description?: string;
  location: { type: 'Point'; coordinates: number[] };
  address?: string;
  operatingHours: string;
  contact: { name?: string; phone?: string };
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}
export type FoodProviderDoc = HydratedDocument<IFoodProvider>;

const schema = new Schema<IFoodProvider>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, maxlength: 1000 },
    location: { type: pointSchema, required: true },
    address: { type: String, trim: true, maxlength: 300 },
    operatingHours: { type: String, trim: true, maxlength: 200, default: '' },
    contact: { name: { type: String, maxlength: 120 }, phone: { type: String, maxlength: 20 } },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);

schema.index({ owner: 1 });
schema.index({ location: '2dsphere' });
schema.index({ status: 1 });

export const FoodProvider = model<IFoodProvider>('FoodProvider', schema);
