import { Schema, model, Types, HydratedDocument } from 'mongoose';

export const FOOD_UNITS = ['meals', 'packages'] as const;

export interface IFoodSupply {
  _id: Types.ObjectId;
  provider: Types.ObjectId;
  foodType: string;
  unit: (typeof FOOD_UNITS)[number];
  quantityTotal: number;
  /** Remaining quantity that has not been allocated. Never negative, never above total. */
  quantityAvailable: number;
  availableUntil?: Date;
  notes?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export type FoodSupplyDoc = HydratedDocument<IFoodSupply>;

const schema = new Schema<IFoodSupply>(
  {
    provider: { type: Schema.Types.ObjectId, ref: 'FoodProvider', required: true },
    foodType: { type: String, required: true, trim: true, maxlength: 120 },
    unit: { type: String, enum: FOOD_UNITS, default: 'meals' },
    quantityTotal: { type: Number, required: true, min: 0, max: 10000000 },
    quantityAvailable: { type: Number, required: true, min: [0, 'quantity_negative'] },
    availableUntil: { type: Date },
    notes: { type: String, maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

schema.index({ provider: 1, active: 1 });

export const FoodSupply = model<IFoodSupply>('FoodSupply', schema);
