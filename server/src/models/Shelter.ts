import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { pointSchema } from './shared';

export const SHELTER_STATUSES = ['open', 'full', 'closed'] as const;
export const FACILITIES = ['water', 'food', 'medical', 'toilets', 'power', 'bedding', 'wheelchair_access', 'pet_friendly', 'women_children_area'] as const;

export interface IShelter {
  _id: Types.ObjectId;
  name: string;
  location: { type: 'Point'; coordinates: number[] };
  address?: string;
  capacity: number;
  occupancy: number;
  facilities: string[];
  accessibilityNotes?: string;
  contact: { name?: string; phone?: string };
  status: (typeof SHELTER_STATUSES)[number];
  coordinator?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
export type ShelterDoc = HydratedDocument<IShelter>;

const schema = new Schema<IShelter>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    location: { type: pointSchema, required: true },
    address: { type: String, trim: true, maxlength: 300 },
    capacity: { type: Number, required: true, min: 1, max: 100000 },
    occupancy: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'occupancy_negative'],
      validate: {
        validator: function (this: { capacity?: number }, v: number) {
          return this.capacity === undefined || v <= this.capacity;
        },
        message: 'occupancy_exceeds_capacity',
      },
    },
    facilities: { type: [String], default: [] },
    accessibilityNotes: { type: String, maxlength: 500 },
    contact: { name: { type: String, maxlength: 120 }, phone: { type: String, maxlength: 20 } },
    status: { type: String, enum: SHELTER_STATUSES, default: 'open' },
    coordinator: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

schema.index({ location: '2dsphere' });
schema.index({ status: 1 });
schema.index({ coordinator: 1 });

export const Shelter = model<IShelter>('Shelter', schema);
