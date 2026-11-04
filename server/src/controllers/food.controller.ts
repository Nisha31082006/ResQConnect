import type { FilterQuery } from 'mongoose';
import { Emergency, FoodAllocation, FoodProvider, FoodSupply, User } from '../models';
import type { FoodAllocationDoc, IFoodAllocation } from '../models/FoodAllocation';
import type { FoodProviderDoc } from '../models/FoodProvider';
import type { FoodSupplyDoc } from '../models/FoodSupply';
import { audit } from '../services/audit.service';
import { notifyRoles, notifyUsers } from '../services/notification.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { latLngOf, pointFrom } from '../utils/geo';
import { idOf } from '../utils/ids';
import { asyncHandler, created, ok, pageMeta, parsePaging } from '../utils/http';
import { emitMapRefresh, emitToRoles, emitToUser } from '../sockets';

/* ---------------- helpers ---------------- */

export function serializeProvider(p: FoodProviderDoc, full: boolean) {
  const ll = latLngOf(p.location);
  return {
    id: String(p._id),
    name: p.name,
    description: p.description,
    location: ll ? { ...ll, address: p.address } : null,
    operatingHours: p.operatingHours,
    status: p.status,
    owner: idOf(p.owner),
    ...(full ? { contact: p.contact } : {}),
  };
}

export const serializeSupply = (s: FoodSupplyDoc) => ({
  id: String(s._id),
  provider: idOf(s.provider),
  foodType: s.foodType,
  unit: s.unit,
  quantityTotal: s.quantityTotal,
  quantityAvailable: s.quantityAvailable,
  quantityAllocated: s.quantityTotal - s.quantityAvailable,
  availableUntil: s.availableUntil,
  notes: s.notes,
  active: s.active,
  updatedAt: s.updatedAt,
});

export function serializeAllocation(a: FoodAllocationDoc) {
  const em = a.emergency as unknown as { _id?: unknown; emergencyId?: string } | undefined;
  const provider = a.provider as unknown as { _id?: unknown; name?: string } | undefined;
  const by = a.requestedBy as unknown as { _id?: unknown; name?: string } | undefined;
  const supply = a.supply as unknown as { _id?: unknown; foodType?: string } | undefined;
  return {
    id: String(a._id),
    status: a.status,
    emergency: em && typeof em === 'object' && 'emergencyId' in em ? { id: String(em._id), emergencyId: em.emergencyId } : a.emergency ? { id: String(a.emergency) } : null,
    community: a.community,
    requestedBy: by && typeof by === 'object' && 'name' in by ? { id: String(by._id), name: by.name } : { id: idOf(a.requestedBy) },
    quantityRequested: a.quantityRequested,
    unit: a.unit,
    deliveryAddress: a.deliveryAddress,
    supply: supply && typeof supply === 'object' && 'foodType' in supply ? { id: String(supply._id), foodType: supply.foodType } : a.supply ? { id: String(a.supply) } : null,
    provider: provider && typeof provider === 'object' && 'name' in provider ? { id: String(provider._id), name: provider.name } : a.provider ? { id: String(a.provider) } : null,
    quantityApproved: a.quantityApproved,
    quantitySupplied: a.quantitySupplied,
    decisionNote: a.decisionNote,
    history: a.history.map((h) => ({ status: h.status, at: h.at, note: h.note })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * Atomically change a supply's remaining quantity (compare-and-set on the value we read).
 * Over-allocation (< 0) and over-return (> total) are rejected on the server, regardless of what the UI sent.
 */
export async function adjustSupply(supplyId: string, delta: number): Promise<FoodSupplyDoc> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const s = await FoodSupply.findById(supplyId);
    if (!s) throw notFound('SUPPLY_NOT_FOUND');
    const next = s.quantityAvailable + delta;
    if (next < 0) throw badRequest('FOOD_OVER_ALLOCATION', `Only ${s.quantityAvailable} ${s.unit} remain available`, [{ path: 'quantity', code: 'food_over_allocation' }]);
    if (next > s.quantityTotal) throw conflict('FOOD_QUANTITY_INCONSISTENT', 'Quantity would exceed the supply total');
    const updated = await FoodSupply.findOneAndUpdate({ _id: s._id, quantityAvailable: s.quantityAvailable }, { quantityAvailable: next }, { new: true });
    if (updated) return updated;
  }
  throw conflict('CONCURRENT_UPDATE', 'The supply was updated by someone else, please retry');
}

async function ownProvider(userId: unknown) {
  return FoodProvider.findOne({ owner: userId });
}

/* ---------------- providers ---------------- */

export const createProvider = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = req.body;
  let ownerId = String(user._id);
  if (user.role === 'admin') {
    if (!b.ownerId) throw badRequest('OWNER_REQUIRED', 'Choose the food provider account that owns this profile', [{ path: 'ownerId', code: 'required' }]);
    const owner = await User.findById(b.ownerId);
    if (!owner || owner.role !== 'food_provider') throw badRequest('OWNER_INVALID', 'The owner must be a food provider account');
    ownerId = String(owner._id);
  }
  if (await FoodProvider.exists({ owner: ownerId })) throw conflict('PROVIDER_EXISTS', 'A provider profile already exists for this account');
  const p = await FoodProvider.create({
    name: b.name,
    owner: ownerId,
    description: b.description,
    location: pointFrom(b.location),
    address: b.location.address,
    operatingHours: b.operatingHours,
    contact: b.contact,
    status: b.status,
  });
  await audit(user, 'food.provider_create', 'FoodProvider', p._id, { name: p.name }, req);
  emitMapRefresh('food', String(p._id));
  return created(res, serializeProvider(p, true));
});

export const listProviders = asyncHandler(async (req, res) => {
  const user = req.user!;
  const filter: FilterQuery<FoodProviderDoc> = {};
  if (user.role === 'food_provider') filter.owner = user._id;
  else if (user.role !== 'admin') filter.status = 'active';
  const items = await FoodProvider.find(filter).sort({ name: 1 });
  return ok(res, items.map((p) => serializeProvider(p, user.role === 'admin' || String(p.owner) === String(user._id))));
});

export const myProvider = asyncHandler(async (req, res) => {
  const p = await ownProvider(req.user!._id);
  return ok(res, p ? serializeProvider(p, true) : null);
});

export const updateProvider = asyncHandler(async (req, res) => {
  const user = req.user!;
  const p = await FoodProvider.findById(req.params.id);
  if (!p) throw notFound('PROVIDER_NOT_FOUND');
  if (user.role !== 'admin' && String(p.owner) !== String(user._id)) throw forbidden('FORBIDDEN_RESOURCE', 'You can only edit your own provider profile');
  const { location, ownerId, ...rest } = req.body;
  if (ownerId && user.role !== 'admin') throw forbidden('FORBIDDEN_ROLE');
  if (location) {
    p.location = pointFrom(location);
    p.address = location.address ?? p.address;
  }
  Object.assign(p, rest);
  await p.save();
  await audit(user, 'food.provider_update', 'FoodProvider', p._id, req.body, req);
  emitMapRefresh('food', String(p._id));
  return ok(res, serializeProvider(p, true));
});

/* ---------------- supplies ---------------- */

export const createSupply = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = req.body;
  const provider = user.role === 'admin' ? await FoodProvider.findById(b.providerId) : await ownProvider(user._id);
  if (!provider) throw notFound('PROVIDER_NOT_FOUND', 'Create your provider profile first');
  const s = await FoodSupply.create({ provider: provider._id, foodType: b.foodType, unit: b.unit, quantityTotal: b.quantityTotal, quantityAvailable: b.quantityTotal, availableUntil: b.availableUntil, notes: b.notes });
  await audit(user, 'food.supply_create', 'FoodSupply', s._id, { foodType: s.foodType, quantity: s.quantityTotal }, req);
  emitToRoles(['admin'], 'food:updated', { supply: String(s._id) });
  return created(res, serializeSupply(s));
});

export const listSupplies = asyncHandler(async (req, res) => {
  const user = req.user!;
  const filter: FilterQuery<FoodSupplyDoc> = {};
  if (user.role === 'food_provider') {
    const p = await ownProvider(user._id);
    filter.provider = p?._id;
    if (!p) return ok(res, []);
  }
  const items = await FoodSupply.find(filter).sort({ createdAt: -1 }).limit(200).populate('provider', 'name');
  return ok(res, items.map((s) => ({ ...serializeSupply(s), providerName: (s.provider as unknown as { name?: string })?.name })));
});

export const updateSupply = asyncHandler(async (req, res) => {
  const user = req.user!;
  const s0 = await FoodSupply.findById(req.params.id).populate('provider');
  if (!s0) throw notFound('SUPPLY_NOT_FOUND');
  const prov = s0.provider as unknown as FoodProviderDoc;
  if (user.role !== 'admin' && String(prov.owner) !== String(user._id)) throw forbidden('FORBIDDEN_RESOURCE', 'You can only edit your own supplies');
  const { quantityTotal, ...rest } = req.body;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const s = await FoodSupply.findById(s0._id);
    if (!s) throw notFound('SUPPLY_NOT_FOUND');
    const allocated = s.quantityTotal - s.quantityAvailable;
    const patch: Record<string, unknown> = { ...rest };
    if (quantityTotal !== undefined) {
      if (quantityTotal < allocated) throw badRequest('TOTAL_BELOW_ALLOCATED', `${allocated} ${s.unit} are already allocated; the total cannot be lower`, [{ path: 'quantityTotal', code: 'total_below_allocated' }]);
      patch.quantityTotal = quantityTotal;
      patch.quantityAvailable = quantityTotal - allocated;
    }
    const updated = await FoodSupply.findOneAndUpdate({ _id: s._id, quantityAvailable: s.quantityAvailable, quantityTotal: s.quantityTotal }, patch, { new: true });
    if (updated) {
      await audit(user, 'food.supply_update', 'FoodSupply', updated._id, req.body, req);
      emitToRoles(['admin'], 'food:updated', { supply: String(updated._id) });
      return ok(res, serializeSupply(updated));
    }
  }
  throw conflict('CONCURRENT_UPDATE', 'The supply was updated by someone else, please retry');
});

/* ---------------- requests & allocations ---------------- */

export const createRequest = asyncHandler(async (req, res) => {
  const user = req.user!;
  const b = req.body as { emergencyId?: string; community?: string; quantityRequested: number; unit: 'meals' | 'packages'; deliveryAddress?: string };
  if (b.emergencyId) {
    const em = await Emergency.findById(b.emergencyId);
    if (!em) throw notFound('EMERGENCY_NOT_FOUND');
    if (user.role === 'citizen' && String(em.reporter) !== String(user._id)) throw forbidden('FORBIDDEN_RESOURCE', 'You can only request food for your own report');
  }
  const a = await FoodAllocation.create({
    emergency: b.emergencyId,
    community: b.community,
    requestedBy: user._id,
    quantityRequested: b.quantityRequested,
    unit: b.unit,
    deliveryAddress: b.deliveryAddress,
    history: [{ status: 'requested', by: user._id, at: new Date() }],
  });
  await notifyRoles(['admin'], { type: 'food_requested', params: { quantity: b.quantityRequested, unit: b.unit }, message: `New food request: ${b.quantityRequested} ${b.unit}`, link: '/admin/food', entityType: 'foodAllocation', entityId: String(a._id) });
  emitToRoles(['admin'], 'food:updated', { allocation: String(a._id) });
  return created(res, serializeAllocation(a));
});

export const listAllocations = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>);
  const filter: FilterQuery<IFoodAllocation> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (user.role === 'food_provider') {
    const p = await ownProvider(user._id);
    if (!p) return ok(res, [], pageMeta(page, limit, 0));
    filter.provider = p._id;
  } else if (user.role !== 'admin') {
    filter.requestedBy = user._id;
  }
  const [items, total] = await Promise.all([
    FoodAllocation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('emergency', 'emergencyId').populate('provider', 'name').populate('supply', 'foodType').populate('requestedBy', 'name'),
    FoodAllocation.countDocuments(filter),
  ]);
  return ok(res, items.map(serializeAllocation), pageMeta(page, limit, total));
});

export const approveAllocation = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { supplyId, quantity, note } = req.body as { supplyId: string; quantity: number; note?: string };
  const a = await FoodAllocation.findById(req.params.id);
  if (!a) throw notFound('ALLOCATION_NOT_FOUND');
  if (a.status !== 'requested') throw conflict('ALLOCATION_NOT_PENDING', 'Only pending requests can be approved');
  if (quantity > a.quantityRequested) throw badRequest('QUANTITY_EXCEEDS_REQUEST', 'You cannot allocate more than was requested', [{ path: 'quantity', code: 'quantity_exceeds_request' }]);
  const supply = await FoodSupply.findById(supplyId).populate('provider');
  if (!supply || !supply.active) throw notFound('SUPPLY_NOT_FOUND', 'Supply not found or inactive');
  const provider = supply.provider as unknown as FoodProviderDoc;
  if (provider.status !== 'active') throw conflict('PROVIDER_INACTIVE', 'This provider is inactive');
  if (supply.unit !== a.unit) throw badRequest('UNIT_MISMATCH', `The request is in ${a.unit} but the supply is in ${supply.unit}`);

  await adjustSupply(supplyId, -quantity); // throws if it would over-allocate
  a.status = 'approved';
  a.supply = supply._id;
  a.provider = provider._id;
  a.quantityApproved = quantity;
  a.approvedBy = user._id;
  a.approvedAt = new Date();
  a.decisionNote = note;
  a.history.push({ status: 'approved', by: user._id, at: new Date(), note });
  await a.save();
  await audit(user, 'food.allocation_approve', 'FoodAllocation', a._id, { supplyId, quantity }, req);
  await notifyUsers([provider.owner], { type: 'food_allocated', params: { quantity, unit: a.unit }, message: `${quantity} ${a.unit} allocated from your supply - please prepare delivery`, link: '/food/requests', entityType: 'foodAllocation', entityId: String(a._id) });
  await notifyUsers([a.requestedBy], { type: 'food_request_approved', params: { quantity, unit: a.unit }, message: `Your food request was approved (${quantity} ${a.unit})`, entityType: 'foodAllocation', entityId: String(a._id) });
  emitToRoles(['admin'], 'food:updated', { allocation: String(a._id) });
  emitToUser(String(provider.owner), 'food:updated', { allocation: String(a._id) });
  return ok(res, serializeAllocation(a));
});

export const rejectAllocation = asyncHandler(async (req, res) => {
  const a = await FoodAllocation.findById(req.params.id);
  if (!a) throw notFound('ALLOCATION_NOT_FOUND');
  if (a.status !== 'requested') throw conflict('ALLOCATION_NOT_PENDING');
  a.status = 'rejected';
  a.decisionNote = req.body.note;
  a.history.push({ status: 'rejected', by: req.user!._id, at: new Date(), note: req.body.note });
  await a.save();
  await audit(req.user, 'food.allocation_reject', 'FoodAllocation', a._id, { note: req.body.note }, req);
  await notifyUsers([a.requestedBy], { type: 'food_request_rejected', params: { reason: req.body.note }, message: `Your food request was declined: ${req.body.note}`, entityType: 'foodAllocation', entityId: String(a._id) });
  return ok(res, serializeAllocation(a));
});

export const updateAllocationStatus = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { status, quantitySupplied, note } = req.body as { status: 'dispatched' | 'delivered' | 'cancelled'; quantitySupplied?: number; note?: string };
  const a = await FoodAllocation.findById(req.params.id).populate('provider');
  if (!a) throw notFound('ALLOCATION_NOT_FOUND');
  const provider = a.provider as unknown as FoodProviderDoc | undefined;
  const isProviderOwner = !!provider && String(provider.owner) === String(user._id);
  const isRequester = String(a.requestedBy) === String(user._id);
  if (!(user.role === 'admin' || isProviderOwner || (status === 'cancelled' && a.status === 'requested' && isRequester))) {
    throw forbidden('FORBIDDEN_RESOURCE', 'You cannot change this request');
  }

  if (status === 'dispatched') {
    if (a.status !== 'approved') throw conflict('INVALID_TRANSITION', 'Only approved allocations can be dispatched');
  } else if (status === 'delivered') {
    if (a.status !== 'dispatched') throw conflict('INVALID_TRANSITION', 'Only dispatched allocations can be marked delivered');
    const supplied = quantitySupplied ?? a.quantityApproved ?? 0;
    if (supplied > (a.quantityApproved ?? 0)) throw badRequest('SUPPLIED_EXCEEDS_APPROVED', 'Supplied quantity cannot exceed the approved quantity', [{ path: 'quantitySupplied', code: 'supplied_exceeds_approved' }]);
    const leftover = (a.quantityApproved ?? 0) - supplied;
    if (leftover > 0 && a.supply) await adjustSupply(String(idOf(a.supply)), leftover); // unused food becomes available again
    a.quantitySupplied = supplied;
  } else {
    if (!['requested', 'approved', 'dispatched'].includes(a.status)) throw conflict('INVALID_TRANSITION', 'This allocation can no longer be cancelled');
    if (['approved', 'dispatched'].includes(a.status) && a.supply && a.quantityApproved) await adjustSupply(String(idOf(a.supply)), a.quantityApproved);
  }
  a.status = status;
  a.history.push({ status, by: user._id, at: new Date(), note });
  await a.save();
  await audit(user, `food.allocation_${status}`, 'FoodAllocation', a._id, { quantitySupplied, note }, req);
  await notifyUsers([a.requestedBy], { type: `food_${status}`, params: { quantity: a.quantitySupplied ?? a.quantityApproved }, message: `Food request ${status}`, entityType: 'foodAllocation', entityId: String(a._id) });
  emitToRoles(['admin'], 'food:updated', { allocation: String(a._id) });
  return ok(res, serializeAllocation(a));
});
