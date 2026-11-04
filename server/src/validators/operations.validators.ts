import { z } from 'zod';
import { BLOCKAGE_TYPES } from '../models/RoadBlockage';
import { FACILITIES } from '../models/Shelter';
import { FOOD_UNITS } from '../models/FoodSupply';
import { ALLOCATION_STATUSES } from '../models/FoodAllocation';
import { SEVERITIES } from '../models/shared';
import { boolish, locationSchema, objectId, optionalPhone, pagingQuery, phone, strList, text } from './common';
import { passwordRule } from './auth.validators';
import { ROLES } from '../models/shared';

const num = (min: number, max: number) => z.coerce.number({ invalid_type_error: 'invalid_number', required_error: 'required' }).min(min, 'too_small').max(max, 'too_large');
const int = (min: number, max: number) => num(min, max).int('invalid_number');

/* ---------------- users ---------------- */
export const adminCreateUserSchema = z.object({
  name: text(2, 120),
  email: z.string().trim().toLowerCase().email('invalid_email'),
  password: passwordRule,
  phone: optionalPhone,
  role: z.enum(ROLES),
  skills: strList().optional(),
});
export const adminUpdateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(['active', 'pending', 'suspended']).optional(),
    name: text(2, 120).optional(),
    skills: strList().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_update' });
export const listUsersQuery = z.object({
  ...pagingQuery,
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'pending', 'suspended']).optional(),
});

/* ---------------- teams / assignments ---------------- */
export const createTeamSchema = z.object({
  name: text(2, 100),
  leaderId: objectId,
  memberIds: z.array(objectId).max(200).default([]),
  skills: strList(),
  capacity: int(1, 200).default(5),
  availability: z.enum(['available', 'busy', 'offline']).default('available'),
  notes: z.string().trim().max(1000).optional(),
});
export const updateTeamSchema = z
  .object({
    name: text(2, 100).optional(),
    leaderId: objectId.optional(),
    skills: strList().optional(),
    capacity: int(1, 200).optional(),
    availability: z.enum(['available', 'busy', 'offline']).optional(),
    notes: z.string().trim().max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_update' });
export const addMembersSchema = z.object({ userIds: z.array(objectId).min(1, 'required').max(100) });
export const teamLocationSchema = z.object({ lat: locationSchema.shape.lat, lng: locationSchema.shape.lng });

export const createAssignmentSchema = z
  .object({
    emergencyId: objectId,
    teamId: objectId.optional(),
    volunteerIds: z.array(objectId).max(50).default([]),
    instructions: z.string().trim().max(2000, 'too_long').optional(),
  })
  .refine((v) => !!v.teamId || v.volunteerIds.length > 0, { message: 'team_or_volunteers_required', path: ['teamId'] });
export const reassignSchema = z.object({
  teamId: objectId.optional(),
  volunteerIds: z.array(objectId).max(50).default([]),
  reason: text(3, 1000),
  instructions: z.string().trim().max(2000, 'too_long').optional(),
});
export const progressSchema = z.object({ note: text(2, 1000), percent: int(0, 100).optional() });

/* ---------------- completion ---------------- */
export const completionSchema = z.object({
  emergencyId: objectId,
  kind: z.enum(['completion', 'assistance']).default('completion'),
  actionsPerformed: text(5, 3000),
  peopleAssisted: int(0, 100000),
  resourcesUsed: z.string().trim().max(2000, 'too_long').default(''),
  notes: z.string().trim().max(3000, 'too_long').optional(),
});
export const completionDecisionSchema = z
  .object({ approve: z.boolean(), reason: z.string().trim().max(1000, 'too_long').optional() })
  .refine((v) => v.approve || (v.reason && v.reason.length >= 3), { message: 'reason_required', path: ['reason'] });

/* ---------------- shelters ---------------- */
const shelterBase = {
  name: text(2, 150),
  location: locationSchema,
  capacity: int(1, 100000),
  occupancy: int(0, 100000).default(0),
  facilities: z.array(z.enum(FACILITIES)).default([]),
  accessibilityNotes: z.string().trim().max(500, 'too_long').optional(),
  contact: z.object({ name: z.string().trim().max(120).optional(), phone: optionalPhone }).default({}),
  status: z.enum(['open', 'full', 'closed']).default('open'),
  coordinatorId: objectId.optional(),
};
export const createShelterSchema = z.object(shelterBase).refine((s) => s.occupancy <= s.capacity, { message: 'occupancy_exceeds_capacity', path: ['occupancy'] });
export const updateShelterSchema = z
  .object({
    name: shelterBase.name.optional(),
    location: shelterBase.location.optional(),
    capacity: shelterBase.capacity.optional(),
    facilities: shelterBase.facilities.optional(),
    accessibilityNotes: shelterBase.accessibilityNotes,
    contact: shelterBase.contact.optional(),
    status: z.enum(['open', 'full', 'closed']).optional(),
    coordinatorId: objectId.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_update' });
export const occupancySchema = z
  .object({ occupancy: int(0, 100000).optional(), delta: int(-100000, 100000).optional() })
  .refine((v) => (v.occupancy === undefined) !== (v.delta === undefined), { message: 'occupancy_or_delta', path: ['occupancy'] });
export const referralSchema = z.object({ emergencyId: objectId.optional(), people: int(1, 100000), note: z.string().trim().max(500).optional() });
export const listSheltersQuery = z.object({
  ...pagingQuery,
  status: z.enum(['open', 'full', 'closed']).optional(),
  availableOnly: boolish.optional(),
  mine: boolish.optional(),
});

/* ---------------- food ---------------- */
export const providerSchema = z.object({
  name: text(2, 150),
  description: z.string().trim().max(1000).optional(),
  location: locationSchema,
  operatingHours: text(2, 200),
  contact: z.object({ name: z.string().trim().max(120).optional(), phone: phone.optional() }).default({}),
  status: z.enum(['active', 'inactive']).default('active'),
  ownerId: objectId.optional(),
});
export const providerUpdateSchema = providerSchema.partial().strict().refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_update' });
export const supplyCreateSchema = z.object({
  providerId: objectId.optional(),
  foodType: text(2, 120),
  unit: z.enum(FOOD_UNITS).default('meals'),
  quantityTotal: int(0, 10000000),
  availableUntil: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});
export const supplyUpdateSchema = z
  .object({
    foodType: text(2, 120).optional(),
    quantityTotal: int(0, 10000000).optional(),
    availableUntil: z.coerce.date().optional(),
    notes: z.string().trim().max(500).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_update' });
export const foodRequestSchema = z
  .object({
    emergencyId: objectId.optional(),
    community: z.string().trim().max(200, 'too_long').optional(),
    quantityRequested: int(1, 10000000),
    unit: z.enum(FOOD_UNITS).default('meals'),
    deliveryAddress: z.string().trim().max(300, 'too_long').optional(),
  })
  .refine((v) => !!v.emergencyId || !!v.community, { message: 'emergency_or_community', path: ['community'] });
export const allocationApproveSchema = z.object({ supplyId: objectId, quantity: int(1, 10000000), note: z.string().trim().max(500).optional() });
export const allocationRejectSchema = z.object({ note: text(3, 500) });
export const allocationStatusSchema = z.object({
  status: z.enum(['dispatched', 'delivered', 'cancelled']),
  quantitySupplied: int(0, 10000000).optional(),
  note: z.string().trim().max(500).optional(),
});
export const listAllocationsQuery = z.object({ ...pagingQuery, status: z.enum(ALLOCATION_STATUSES).optional() });

/* ---------------- roads ---------------- */
export const roadReportSchema = z.object({
  type: z.enum(BLOCKAGE_TYPES, { errorMap: () => ({ message: 'invalid_type' }) }),
  description: text(5, 2000),
  severity: z.enum(SEVERITIES).default('medium'),
  location: locationSchema,
  reportedAt: z.coerce.date().max(new Date(Date.now() + 5 * 60 * 1000), 'date_in_future').optional(),
});
export const roadVerifySchema = z.object({ verify: z.boolean(), note: z.string().trim().max(1000, 'too_long').optional() });
export const clearanceSchema = z.object({ note: text(5, 2000) });
export const clearanceDecisionSchema = z
  .object({ approve: z.boolean(), reason: z.string().trim().max(1000, 'too_long').optional() })
  .refine((v) => v.approve || (v.reason && v.reason.length >= 3), { message: 'reason_required', path: ['reason'] });

/* ---------------- escalations / settings / audit ---------------- */
export const escalationNoteSchema = z.object({ note: z.string().trim().max(1000, 'too_long').optional() });
export const listEscalationsQuery = z.object({ ...pagingQuery, status: z.enum(['open', 'acknowledged', 'resolved']).optional() });
export const settingsSchema = z
  .object({
    ackDeadlineSeconds: int(10, 86400).optional(),
    maxEscalationLevel: int(1, 5).optional(),
    smsEmergencyNumber: phone.optional(),
    duplicateRules: z
      .object({ radiusMeters: int(10, 20000), windowMinutes: int(5, 10080), similarityThreshold: num(0, 1) })
      .partial()
      .optional(),
    priority: z
      .object({
        thresholds: z.object({ critical: int(1, 500), high: int(1, 500), medium: int(1, 500) }).partial().optional(),
      })
      .optional(),
    automation: z
      .object({
        zones: z.object({ radiusMeters: int(50, 50000), windowMinutes: int(5, 10080), minReports: int(2, 100), sameTypeOnly: z.boolean() }).partial().strict().optional(),
        workload: z.object({ overloadedAt: int(1, 50) }).partial().strict().optional(),
        teamFormation: z.object({ maxDistanceKm: int(1, 2000) }).partial().strict().optional(),
        shelter: z.object({ maxDistanceKm: int(1, 2000), nearFullPercent: int(50, 100) }).partial().strict().optional(),
        food: z.object({ mealsPerPersonPerDay: int(1, 10), days: int(1, 30) }).partial().strict().optional(),
        followUp: z
          .object({ emergencyIdleMinutes: int(1, 10080), progressIdleMinutes: int(1, 10080), shelterStaleMinutes: int(1, 20160), repeatMinutes: int(1, 10080), maxReminders: int(1, 50) })
          .partial()
          .strict()
          .optional(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const t = v.priority?.thresholds;
    if (t && t.critical !== undefined && t.high !== undefined && t.medium !== undefined && !(t.critical > t.high && t.high > t.medium)) {
      ctx.addIssue({ code: 'custom', message: 'thresholds_order', path: ['priority', 'thresholds'] });
    }
  });
export const listAuditQuery = z.object({
  ...pagingQuery,
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
});
export const listNotificationsQuery = z.object({ ...pagingQuery, unread: boolish.optional() });
export const mapQuery = z.object({
  type: z.string().trim().max(40).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.string().trim().max(40).optional(),
});

/* ---------------- SMS ---------------- */
export const smsInboundSchema = z.object({
  from: z.string().trim().min(5).max(30),
  body: z.string().trim().min(1).max(1000),
  messageId: z.string().trim().max(100).optional(),
});

/* ---------------- automation ---------------- */
export const approveFormationSchema = z.object({
  emergencyId: objectId,
  teamId: objectId.optional(),
  volunteerIds: z.array(objectId).max(50).default([]),
  addToTeam: z.boolean().default(false),
  instructions: z.string().trim().max(2000, 'too_long').optional(),
}).refine((v) => !!v.teamId || v.volunteerIds.length > 0, { message: 'team_or_volunteers_required', path: ['teamId'] });
export const zoneReviewSchema = z.object({ decision: z.enum(['reviewed', 'dismissed']), note: z.string().trim().max(1000).optional() });
export const confirmShelterSchema = z.object({ shelterId: objectId, people: int(1, 100000).optional(), note: z.string().trim().max(500).optional() });
export const myLocationSchema = z.object({ lat: locationSchema.shape.lat, lng: locationSchema.shape.lng });
