import type { FilterQuery } from 'mongoose';
import { AuditLog, CompletionReport, Emergency, Escalation, FoodAllocation, RoadBlockage, RoadClearanceReport, Shelter, User } from '../models';
import type { IAuditLog } from '../models/AuditLog';
import { audit } from '../services/audit.service';
import { computeStaffing } from '../services/emergency.service';
import { getSettings, updateSettings } from '../services/settings.service';
import { asyncHandler, ok, pageMeta, parsePaging } from '../utils/http';

export const getAppSettings = asyncHandler(async (_req, res) => ok(res, await getSettings()));

export const putAppSettings = asyncHandler(async (req, res) => {
  const before = await getSettings();
  const next = await updateSettings(req.body, req.user!._id);
  await audit(req.user, 'settings.update', 'Setting', 'app', { before: { ack: before.ackDeadlineSeconds, sms: before.smsEmergencyNumber }, patch: req.body }, req);
  return ok(res, next);
});

/** Public (no auth) subset used by the offline SMS fallback screen. */
export const publicConfig = asyncHandler(async (_req, res) => {
  const s = await getSettings();
  return ok(res, { smsEmergencyNumber: s.smsEmergencyNumber, ackDeadlineSeconds: s.ackDeadlineSeconds });
});

export const listAudit = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, { page: 1, limit: 20, maxLimit: 100 });
  const q = req.query as { action?: string; entityType?: string };
  const filter: FilterQuery<IAuditLog> = {};
  if (q.action) filter.action = q.action;
  if (q.entityType) filter.entityType = q.entityType;
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actor', 'name'), AuditLog.countDocuments(filter)]);
  return ok(
    res,
    items.map((a) => ({
      id: String(a._id),
      at: a.createdAt,
      actor: (a.actor as unknown as { name?: string })?.name ?? null,
      actorRole: a.actorRole,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      details: a.details,
    })),
    pageMeta(page, limit, total),
  );
});

export const dashboardStats = asyncHandler(async (_req, res) => {
  const active = { status: { $ne: 'resolved' } };
  const [byStatus, activeSos, pendingSos, escalationsOpen, pendingCompletions, pendingRoads, pendingClearances, pendingFood, pendingUsers, duplicates, byPriority, shelterAgg] = await Promise.all([
    Emergency.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Emergency.countDocuments({ kind: 'sos', ...active }),
    Emergency.countDocuments({ kind: 'sos', status: 'pending' }),
    Escalation.countDocuments({ status: 'open' }),
    CompletionReport.countDocuments({ kind: 'completion', status: { $in: ['submitted', 'under_review'] } }),
    RoadBlockage.countDocuments({ verificationStatus: 'unverified' }),
    RoadClearanceReport.countDocuments({ status: 'pending' }),
    FoodAllocation.countDocuments({ status: 'requested' }),
    User.countDocuments({ status: 'pending' }),
    Emergency.countDocuments({ 'duplicateCandidates.reviewStatus': 'pending' }),
    Emergency.aggregate([{ $match: active }, { $group: { _id: '$priorityRank', count: { $sum: 1 } } }]),
    Shelter.aggregate([{ $match: { status: { $ne: 'closed' } } }, { $group: { _id: null, capacity: { $sum: '$capacity' }, occupancy: { $sum: '$occupancy' } } }]),
  ]);
  const needsUnits = await Emergency.find({ ...active, requiredVolunteers: { $gt: 0 } }).select('_id requiredVolunteers emergencyId');
  const staffing = await computeStaffing(needsUnits);
  const gaps = [...staffing.values()].filter((s) => s.gap > 0).length;
  const rankName: Record<number, string> = { 4: 'critical', 3: 'high', 2: 'medium', 1: 'low' };
  return ok(res, {
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    byPriority: Object.fromEntries(byPriority.map((p) => [rankName[p._id as number] ?? 'low', p.count])),
    activeSos,
    pendingSos,
    escalationsOpen,
    pendingCompletions,
    pendingRoads: pendingRoads + pendingClearances,
    pendingFood,
    pendingUsers,
    duplicates,
    staffingGaps: gaps,
    shelters: { capacity: shelterAgg[0]?.capacity ?? 0, occupancy: shelterAgg[0]?.occupancy ?? 0 },
  });
});
