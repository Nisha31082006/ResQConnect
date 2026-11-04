import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { FOOD_UNITS } from './FoodSupply';

export const ALLOCATION_STATUSES = ['requested', 'approved', 'dispatched', 'delivered', 'rejected', 'cancelled'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

/**
 * A food request (linked to an emergency or a named community) that an administrator reviews and allocates
 * from one supply. Lifecycle: requested -> approved -> dispatched -> delivered (or rejected / cancelled).
 */
export interface IFoodAllocation {
  _id: Types.ObjectId;
  emergency?: Types.ObjectId;
  community?: string;
  requestedBy: Types.ObjectId;
  quantityRequested: number;
  unit: (typeof FOOD_UNITS)[number];
  deliveryAddress?: string;
  status: AllocationStatus;
  supply?: Types.ObjectId;
  provider?: Types.ObjectId;
  quantityApproved?: number;
  quantitySupplied?: number;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  decisionNote?: string;
  history: { status: string; by: Types.ObjectId; at: Date; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}
export type FoodAllocationDoc = HydratedDocument<IFoodAllocation>;

const schema = new Schema<IFoodAllocation>(
  {
    emergency: { type: Schema.Types.ObjectId, ref: 'Emergency' },
    community: { type: String, trim: true, maxlength: 200 },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    quantityRequested: { type: Number, required: true, min: 1, max: 10000000 },
    unit: { type: String, enum: FOOD_UNITS, default: 'meals' },
    deliveryAddress: { type: String, maxlength: 300 },
    status: { type: String, enum: ALLOCATION_STATUSES, default: 'requested' },
    supply: { type: Schema.Types.ObjectId, ref: 'FoodSupply' },
    provider: { type: Schema.Types.ObjectId, ref: 'FoodProvider' },
    quantityApproved: { type: Number, min: 1 },
    quantitySupplied: { type: Number, min: 0 },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    decisionNote: { type: String, maxlength: 500 },
    history: {
      type: [
        new Schema(
          {
            status: String,
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
            note: { type: String, maxlength: 500 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

schema.index({ status: 1, createdAt: -1 });
schema.index({ provider: 1, status: 1 });
schema.index({ supply: 1 });
schema.index({ emergency: 1 });

export const FoodAllocation = model<IFoodAllocation>('FoodAllocation', schema);
