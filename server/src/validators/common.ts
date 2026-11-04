import { z } from 'zod';
import { Types } from 'mongoose';

/** Validation messages are stable codes (translated by the client under "validation.*"). */
export const objectId = z.string({ required_error: 'required' }).refine((v) => Types.ObjectId.isValid(v) && v.length === 24, 'invalid_id');

export const idParams = z.object({ id: objectId });

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,17}$/, 'invalid_phone');

export const optionalPhone = z.preprocess((v) => (v === '' || v === null ? undefined : v), phone.optional());

export const locationSchema = z.object({
  lat: z.coerce.number({ invalid_type_error: 'invalid_coordinates', required_error: 'required' }).min(-90, 'invalid_coordinates').max(90, 'invalid_coordinates'),
  lng: z.coerce.number({ invalid_type_error: 'invalid_coordinates', required_error: 'required' }).min(-180, 'invalid_coordinates').max(180, 'invalid_coordinates'),
  address: z.string().trim().max(300, 'too_long').optional(),
});

export const text = (min = 1, max = 2000) =>
  z
    .string({ required_error: 'required', invalid_type_error: 'required' })
    .trim()
    .min(min, min <= 1 ? 'required' : 'too_short')
    .max(max, 'too_long');

export const strList = (maxItems = 20, maxLen = 60) => z.array(z.string().trim().min(1).max(maxLen, 'too_long')).max(maxItems, 'too_many').default([]);

export const pagingQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
};

export const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
