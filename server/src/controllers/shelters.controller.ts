import type { FilterQuery } from 'mongoose';
import { Emergency, Shelter, ShelterReferral } from '../models';
import type { IShelter, ShelterDoc } from '../models/Shelter';
import { audit } from '../services/audit.service';
import { notifyRoles, notifyUsers } from '../services/notification.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { latLngOf, pointFrom } from '../utils/geo';
import { idOf } from '../utils/ids';
import { asyncHandler, created, escapeRegex, ok, pageMeta, parsePaging } from '../utils/http';
import { emitMapRefresh, emitToRoles } from '../sockets';

export function serializeShelter(s: ShelterDoc, viewer: 'admin' | 'other' = 'other') {
  const ll = latLngOf(s.location);
  return {
    id: String(s._id),
    name: s.name,
    location: ll ? { ...ll, address: s.address } : null,
    capacity: s.capacity,
    occupancy: s.occupancy,
    available: Math.max(0, s.capacity - s.occupancy),
    facilities: s.facilities,
    accessibilityNotes: s.accessibilityNotes,
    contact: s.contact,
    status: s.status,
    updatedAt: s.updatedAt,
    ...(viewer === 'admin' ? { createdAt: s.createdAt, coordinator: s.coordinator ? idOf(s.coordinator) : null } : {}),
  };
}

async function canManage(req: { user?: { role: string; _id: unknown } }, shelter: ShelterDoc) {
  const u = req.user!;
  if (u.role === 'admin') return true;
  return u.role === 'shelter_coordinator' && !!shelter.coordinator && String(shelter.coordinator) === String(u._id);
}

/**
 * Compare-and-set occupancy update. The filter includes the occupancy we read, so concurrent updates can never
 * push the shelter above capacity or below zero; on contention we re-read and retry.
 */
export async function applyOccupancy(shelterId: string, compute: (current: IShelter) => number): Promise<ShelterDoc> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const s = await Shelter.findById(shelterId);
    if (!s) throw notFound('SHELTER_NOT_FOUND');
    const next = compute(s);
    if (!Number.isInteger(next) || next < 0) throw badRequest('OCCUPANCY_NEGATIVE', 'Occupancy cannot be negative', [{ path: 'occupancy', code: 'occupancy_negative' }]);
    if (next > s.capacity) throw badRequest('OCCUPANCY_EXCEEDS_CAPACITY', `Occupancy cannot exceed the capacity of ${s.capacity}`, [{ path: 'occupancy', code: 'occupancy_exceeds_capacity' }]);
    const status = s.status === 'closed' ? 'closed' : next >= s.capacity ? 'full' : 'open';
    const updated = await Shelter.findOneAndUpdate({ _id: s._id, occupancy: s.occupancy }, { occupancy: next, status, occupancyUpdatedAt: new Date() }, { new: true });
    if (updated) return updated;
  }
  throw conflict('CONCURRENT_UPDATE', 'The shelter was updated by someone else, please retry');
}

export const listShelters = asyncHandler(async (req, res) => {
  const q = req.query as unknown as { search?: string; status?: string; availableOnly?: boolean; sort?: string; order: 'asc' | 'desc' };
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, { page: 1, limit: 20, maxLimit: 100 });
  const filter: FilterQuery<IShelter> = {};
  if (q.status) filter.status = q.status;
  if (q.availableOnly) filter.status = 'open';
  if (q.search) filter.name = new RegExp(escapeRegex(q.search), 'i');
  if (req.user!.role === 'shelter_coordinator' && (req.query as { mine?: boolean }).mine === true) filter.coordinator = req.user!._id;
  const sortField = ['name', 'capacity', 'occupancy', 'updatedAt'].includes(q.sort ?? '') ? (q.sort as string) : 'name';
  const [items, total] = await Promise.all([Shelter.find(filter).sort({ [sortField]: q.order === 'asc' ? 1 : -1 }).skip(skip).limit(limit), Shelter.countDocuments(filter)]);
  const viewer = req.user!.role === 'admin' ? 'admin' : 'other';
  let rows = items.map((s) => serializeShelter(s, viewer));
  if (q.availableOnly) rows = rows.filter((r) => r.available > 0);
  return ok(res, rows, pageMeta(page, limit, total));
});

export const getShelter = asyncHandler(async (req, res) => {
  const s = await Shelter.findById(req.params.id);
  if (!s) throw notFound('SHELTER_NOT_FOUND');
  return ok(res, serializeShelter(s, req.user!.role === 'admin' ? 'admin' : 'other'));
});

export const createShelter = asyncHandler(async (req, res) => {
  const b = req.body;
  const s = await Shelter.create({
    name: b.name,
    location: pointFrom(b.location),
    address: b.location.address,
    capacity: b.capacity,
    occupancy: b.occupancy,
    facilities: b.facilities,
    accessibilityNotes: b.accessibilityNotes,
    contact: b.contact,
    status: b.occupancy >= b.capacity ? 'full' : b.status,
    coordinator: b.coordinatorId,
    createdBy: req.user!._id,
  });
  await audit(req.user, 'shelter.create', 'Shelter', s._id, { name: s.name, capacity: s.capacity }, req);
  emitMapRefresh('shelter', String(s._id));
  emitToRoles(['admin', 'shelter_coordinator', 'citizen'], 'shelter:updated', { id: String(s._id) });
  return created(res, serializeShelter(s, 'admin'));
});

export const updateShelter = asyncHandler(async (req, res) => {
  const s = await Shelter.findById(req.params.id);
  if (!s) throw notFound('SHELTER_NOT_FOUND');
  if (!(await canManage(req, s))) throw forbidden('FORBIDDEN_RESOURCE', 'You can only manage your own shelter');
  const { coordinatorId, location, ...rest } = req.body;
  if (coordinatorId !== undefined) {
    if (req.user!.role !== 'admin') throw forbidden('FORBIDDEN_ROLE', 'Only administrators can change the coordinator');
    s.coordinator = coordinatorId;
  }
  if (rest.capacity !== undefined && rest.capacity < s.occupancy) throw badRequest('CAPACITY_BELOW_OCCUPANCY', 'Capacity cannot be lower than the current occupancy', [{ path: 'capacity', code: 'occupancy_exceeds_capacity' }]);
  if (location) {
    s.location = pointFrom(location);
    s.address = location.address ?? s.address;
  }
  Object.assign(s, rest);
  if (s.status !== 'closed') s.status = s.occupancy >= s.capacity ? 'full' : 'open';
  if (rest.status === 'closed') s.status = 'closed';
  await s.save();
  await audit(req.user, 'shelter.update', 'Shelter', s._id, req.body, req);
  emitMapRefresh('shelter', String(s._id));
  emitToRoles(['admin', 'shelter_coordinator', 'citizen'], 'shelter:updated', { id: String(s._id) });
  return ok(res, serializeShelter(s, req.user!.role === 'admin' ? 'admin' : 'other'));
});

export const updateOccupancy = asyncHandler(async (req, res) => {
  const s0 = await Shelter.findById(req.params.id);
  if (!s0) throw notFound('SHELTER_NOT_FOUND');
  if (!(await canManage(req, s0))) throw forbidden('FORBIDDEN_RESOURCE', 'You can only manage your own shelter');
  const { occupancy, delta } = req.body as { occupancy?: number; delta?: number };
  const s = await applyOccupancy(String(s0._id), (cur) => (occupancy !== undefined ? occupancy : cur.occupancy + (delta ?? 0)));
  await audit(req.user, 'shelter.occupancy', 'Shelter', s._id, { from: s0.occupancy, to: s.occupancy }, req);
  emitMapRefresh('shelter', String(s._id));
  emitToRoles(['admin', 'shelter_coordinator', 'citizen'], 'shelter:updated', { id: String(s._id), available: s.capacity - s.occupancy });
  return ok(res, serializeShelter(s, req.user!.role === 'admin' ? 'admin' : 'other'));
});

/* ---------------- referrals (admin-approved) ---------------- */

export const createReferral = asyncHandler(async (req, res) => {
  const s = await Shelter.findById(req.params.id);
  if (!s) throw notFound('SHELTER_NOT_FOUND');
  if (s.status === 'closed') throw conflict('SHELTER_CLOSED', 'This shelter is closed');
  const { emergencyId, people, note } = req.body as { emergencyId?: string; people: number; note?: string };
  const pending = await ShelterReferral.aggregate([{ $match: { shelter: s._id, status: 'referred' } }, { $group: { _id: null, total: { $sum: '$people' } } }]);
  const reserved = pending[0]?.total ?? 0;
  if (s.occupancy + reserved + people > s.capacity) throw badRequest('SHELTER_CAPACITY_INSUFFICIENT', `Only ${Math.max(0, s.capacity - s.occupancy - reserved)} places remain (including pending referrals)`);
  if (emergencyId && !(await Emergency.exists({ _id: emergencyId }))) throw notFound('EMERGENCY_NOT_FOUND');
  const ref = await ShelterReferral.create({ shelter: s._id, emergency: emergencyId, people, note, approvedBy: req.user!._id });
  await audit(req.user, 'shelter.referral', 'Shelter', s._id, { people, emergencyId }, req);
  if (s.coordinator) {
    await notifyUsers([s.coordinator], { type: 'shelter_referral', params: { shelter: s.name, people }, message: `${people} people referred to ${s.name}`, link: '/shelter/profile', entityType: 'shelter', entityId: String(s._id) });
  }
  return created(res, { id: String(ref._id), shelter: String(s._id), people, status: ref.status });
});

export const listReferrals = asyncHandler(async (req, res) => {
  const s = await Shelter.findById(req.params.id);
  if (!s) throw notFound('SHELTER_NOT_FOUND');
  if (!(await canManage(req, s))) throw forbidden('FORBIDDEN_RESOURCE');
  const refs = await ShelterReferral.find({ shelter: s._id }).sort({ createdAt: -1 }).limit(100).populate('emergency', 'emergencyId type');
  return ok(
    res,
    refs.map((r) => ({
      id: String(r._id),
      people: r.people,
      status: r.status,
      note: r.note,
      emergency: r.emergency ? { id: idOf(r.emergency), emergencyId: (r.emergency as unknown as { emergencyId: string }).emergencyId } : null,
      createdAt: r.createdAt,
      admittedAt: r.admittedAt,
    })),
  );
});

/** The coordinator confirms that referred people arrived -> occupancy increases (validated against capacity). */
export const admitReferral = asyncHandler(async (req, res) => {
  const ref = await ShelterReferral.findById(req.params.referralId);
  if (!ref || String(ref.shelter) !== req.params.id) throw notFound('REFERRAL_NOT_FOUND');
  const s0 = await Shelter.findById(ref.shelter);
  if (!s0) throw notFound('SHELTER_NOT_FOUND');
  if (!(await canManage(req, s0))) throw forbidden('FORBIDDEN_RESOURCE');
  if (ref.status !== 'referred') throw conflict('REFERRAL_NOT_PENDING', 'This referral was already processed');
  const s = await applyOccupancy(String(s0._id), (cur) => cur.occupancy + ref.people);
  ref.status = 'admitted';
  ref.admittedBy = req.user!._id;
  ref.admittedAt = new Date();
  await ref.save();
  await audit(req.user, 'shelter.referral_admit', 'Shelter', s._id, { people: ref.people }, req);
  emitMapRefresh('shelter', String(s._id));
  emitToRoles(['admin', 'shelter_coordinator', 'citizen'], 'shelter:updated', { id: String(s._id) });
  await notifyRoles(['admin'], { type: 'shelter_admitted', params: { shelter: s.name, people: ref.people }, message: `${ref.people} people admitted at ${s.name}`, entityType: 'shelter', entityId: String(s._id) });
  return ok(res, serializeShelter(s));
});
