import { z } from 'zod';
import { EMERGENCY_STATUSES, EMERGENCY_TYPES, PRIORITY_LEVELS, SEVERITIES } from '../models/shared';
import { boolish, locationSchema, objectId, optionalPhone, pagingQuery, strList, text } from './common';

const vulnerable = z
  .object({
    children: z.boolean().default(false),
    elderly: z.boolean().default(false),
    disabled: z.boolean().default(false),
    pregnant: z.boolean().default(false),
    injured: z.boolean().default(false),
  })
  .default({});

const contact = z
  .object({
    name: z.string().trim().max(120, 'too_long').optional(),
    phone: optionalPhone,
  })
  .default({});

const typeEnum = z.enum(EMERGENCY_TYPES, { errorMap: () => ({ message: 'invalid_type' }) });
const affected = z.coerce.number({ invalid_type_error: 'invalid_number', required_error: 'required' }).int('invalid_number').min(1, 'min_one').max(100000, 'too_large');

/** Full report form. */
export const createEmergencySchema = z.object({
  clientRequestId: z.string().trim().min(8, 'invalid_request_id').max(80, 'invalid_request_id').optional(),
  type: typeEnum,
  description: text(10, 4000),
  affectedCount: affected,
  dangerToLife: z.boolean().default(false),
  severity: z.enum(SEVERITIES).default('medium'),
  vulnerable,
  assistanceNeeds: strList(),
  contact: contact.refine((c) => !!c.phone || !!c.name, { message: 'contact_required', path: ['phone'] }),
  location: locationSchema,
  occurredAt: z.coerce.date().max(new Date(Date.now() + 5 * 60 * 1000), 'date_in_future').optional(),
  source: z.enum(['web', 'offline_sync']).default('web'),
});

/** Simplified SOS form: only what is needed immediately. */
export const createSosSchema = z.object({
  clientRequestId: z.string().trim().min(8, 'invalid_request_id').max(80, 'invalid_request_id').optional(),
  type: typeEnum,
  description: text(3, 1000),
  affectedCount: affected.default(1),
  dangerToLife: z.boolean().default(true),
  vulnerable,
  contact,
  location: locationSchema,
  occurredAt: z.coerce.date().max(new Date(Date.now() + 5 * 60 * 1000), 'date_in_future').optional(),
  source: z.enum(['web', 'offline_sync']).default('web'),
});

/** Owner edit (SOS revision flow). At least one field must be present. */
export const updateEmergencySchema = z
  .object({
    description: text(3, 4000).optional(),
    affectedCount: affected.optional(),
    dangerToLife: z.boolean().optional(),
    severity: z.enum(SEVERITIES).optional(),
    vulnerable: vulnerable.optional(),
    assistanceNeeds: strList().optional(),
    location: locationSchema.optional(),
    contact: contact.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_update' });

export const listEmergenciesQuery = z.object({
  ...pagingQuery,
  status: z.enum(EMERGENCY_STATUSES).optional(),
  priority: z.enum(PRIORITY_LEVELS).optional(),
  type: typeEnum.optional(),
  kind: z.enum(['normal', 'sos']).optional(),
  duplicates: boolish.optional(),
  mine: boolish.optional(),
});

export const priorityDecisionSchema = z.object({
  level: z.enum(PRIORITY_LEVELS, { errorMap: () => ({ message: 'invalid_priority' }) }),
  overrideReason: z.string().trim().max(1000, 'too_long').optional(),
});

export const requirementsSchema = z.object({
  requiredVolunteers: z.coerce.number().int().min(0).max(1000),
  requiredSkills: strList(),
});

export const statusChangeSchema = z.object({
  to: z.enum(['acknowledged', 'in_progress']),
  note: z.string().trim().max(1000, 'too_long').optional(),
});

export const duplicateReviewSchema = z.object({
  otherId: objectId,
  decision: z.enum(['related', 'confirmed_duplicate', 'not_duplicate']),
  note: z.string().trim().max(1000, 'too_long').optional(),
});

export const smsPreparedSchema = z.object({ note: z.string().trim().max(500).optional() });
