import type { Request, Response } from 'express';
import type { FilterQuery } from 'mongoose';
import { Assignment, Emergency, EmergencyRevision } from '../models';
import type { EmergencyDoc, IEmergency } from '../models/Emergency';
import { toAttachments } from '../middleware/upload';
import { audit } from '../services/audit.service';
import { assignedUserIds, suggestForEmergency } from '../services/assignment.service';
import { detectDuplicates } from '../services/duplicate.service';
import {
  computeStaffing,
  createEmergencyDoc,
  effectivePriority,
  emergencyScope,
  emitEmergencyEvent,
  refreshRecommendation,
  serializeEmergency,
  transitionEmergency,
  viewLevelFor,
  type ViewLevel,
} from '../services/emergency.service';
import { notifyRoles, notifyUsers } from '../services/notification.service';
import { getSettings } from '../services/settings.service';
import { recommendPriority, PRIORITY_RANK } from '../services/priority.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { latLngOf, pointFrom } from '../utils/geo';
import { asyncHandler, created, escapeRegex, ok, pageMeta, parsePaging } from '../utils/http';
import { emitToRoles } from '../sockets';

const SORTABLE: Record<string, string> = { createdAt: 'createdAt', status: 'status', priority: 'priorityRank', affected: 'affectedCount', type: 'type' };

async function loadForViewer(req: Request): Promise<{ em: EmergencyDoc; level: ViewLevel }> {
  const em = await Emergency.findById(req.params.id).populate('reporter', 'name email phone');
  if (!em) throw notFound('EMERGENCY_NOT_FOUND', 'Emergency not found');
  const level = await viewLevelFor(req.user!, em);
  if (!level) throw forbidden('FORBIDDEN_RESOURCE', 'You do not have access to this emergency');
  return { em, level };
}

/** Is the signed-in user the reporter? (reporter may be populated) */
const isOwner = (em: EmergencyDoc, userId: unknown) => {
  const r = em.reporter as unknown as { _id?: unknown } | undefined;
  const id = r && typeof r === 'object' && '_id' in r ? r._id : r;
  return !!id && String(id) === String(userId);
};

/* ------------------------------------------------------------------ */
/* Create (normal report and SOS share the same idempotent pipeline)    */
/* ------------------------------------------------------------------ */

async function handleCreate(req: Request, res: Response, kind: 'normal' | 'sos') {
  const user = req.user!;
  if (!['citizen', 'admin'].includes(user.role)) throw forbidden('FORBIDDEN_ROLE', 'Only citizens can report emergencies');
  const b = req.body;

  // Idempotency: the same client-generated request id always maps to the same report.
  const findExisting = async () => (b.clientRequestId ? Emergency.findOne({ clientRequestId: b.clientRequestId }).populate('reporter', 'name email phone') : null);
  const existing = await findExisting();
  if (existing) {
    if (!isOwner(existing, user._id)) throw conflict('REQUEST_ID_CONFLICT', 'This request id was already used');
    return ok(res, serializeEmergency(existing, 'owner'), { idempotent: true });
  }

  let em: EmergencyDoc;
  try {
    em = await createEmergencyDoc({
      kind,
      source: b.source === 'offline_sync' ? 'offline_sync' : user.role === 'admin' ? 'admin' : 'web',
      clientRequestId: b.clientRequestId,
      type: b.type,
      description: b.description,
      affectedCount: b.affectedCount,
      dangerToLife: b.dangerToLife ?? kind === 'sos',
      severity: kind === 'sos' ? (b.dangerToLife === false ? 'medium' : 'high') : b.severity,
      vulnerable: b.vulnerable,
      assistanceNeeds: b.assistanceNeeds ?? [],
      contact: { name: b.contact?.name ?? user.name, phone: b.contact?.phone ?? user.phone },
      location: pointFrom(b.location),
      address: b.location.address,
      occurredAt: b.occurredAt ?? new Date(),
      evidence: toAttachments(req),
      reporter: user._id,
    });
  } catch (err) {
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (e.code === 11000 && e.keyPattern && 'clientRequestId' in e.keyPattern) {
      // Lost a race with a concurrent retry of the same request: return the winner.
      const winner = await findExisting();
      if (winner) return ok(res, serializeEmergency(winner, 'owner'), { idempotent: true });
    }
    throw err;
  }

  const matches = await detectDuplicates(em);
  const isSos = kind === 'sos';
  await notifyRoles(['admin'], {
    type: isSos ? 'sos_created' : 'emergency_created',
    params: { emergencyId: em.emergencyId, type: em.type, affected: em.affectedCount },
    message: `${isSos ? 'SOS' : 'New emergency'} ${em.emergencyId} (${em.type}, ${em.affectedCount} people)`,
    link: `/admin/emergencies/${em._id}`,
    entityType: 'emergency',
    entityId: String(em._id),
  });
  if (matches.length > 0) {
    await notifyRoles(['admin'], {
      type: 'duplicate_suspected',
      params: { emergencyId: em.emergencyId, count: matches.length },
      message: `${em.emergencyId} may duplicate ${matches.length} other report(s)`,
      link: '/admin/duplicates',
      entityType: 'emergency',
      entityId: String(em._id),
    });
  }
  await emitEmergencyEvent(em, isSos ? 'sos:created' : 'emergency:created');
  return created(res, serializeEmergency(em, 'owner'), { idempotent: false, duplicateSuspected: matches.length > 0 });
}

export const createEmergency = asyncHandler((req, res) => handleCreate(req, res, 'normal'));
export const createSos = asyncHandler((req, res) => handleCreate(req, res, 'sos'));

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export const listEmergencies = asyncHandler(async (req, res) => {
  const user = req.user!;
  const q = req.query as unknown as Record<string, string | boolean | undefined> & { order: 'asc' | 'desc' };
  const scope = await emergencyScope(user);
  if (!scope) throw forbidden('FORBIDDEN_ROLE', 'Your role cannot list emergencies');
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>);

  const filter: FilterQuery<IEmergency> = { ...scope };
  if (q.status) filter.status = q.status as string;
  if (q.type) filter.type = q.type as string;
  if (q.kind) filter.kind = q.kind as string;
  if (q.priority) filter.priorityRank = PRIORITY_RANK[q.priority as keyof typeof PRIORITY_RANK];
  if (q.duplicates === true && user.role === 'admin') filter['duplicateCandidates.reviewStatus'] = 'pending';
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search)), 'i');
    filter.$and = [{ $or: [{ emergencyId: rx }, { description: rx }, { address: rx }] }];
  }
  const sortField = SORTABLE[String(q.sort ?? '')] ?? 'createdAt';
  const dir = q.order === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [sortField]: dir };
  if (sortField !== 'createdAt') sort.createdAt = -1;

  const level: ViewLevel = user.role === 'admin' ? 'admin' : user.role === 'citizen' ? 'owner' : 'responder';
  const query = Emergency.find(filter).sort(sort).skip(skip).limit(limit);
  if (level === 'admin') query.populate('reporter', 'name email phone');
  const [items, total] = await Promise.all([query, Emergency.countDocuments(filter)]);
  const staffing = level === 'admin' ? await computeStaffing(items) : new Map();
  return ok(
    res,
    items.map((em) => serializeEmergency(em, level, level === 'admin' ? { staffing: staffing.get(String(em._id)) } : {})),
    pageMeta(page, limit, total),
  );
});

export const getEmergency = asyncHandler(async (req, res) => {
  const { em, level } = await loadForViewer(req);
  const extra: Record<string, unknown> = {};
  const assignments = await Assignment.find({ emergency: em._id }).populate('team', 'name').populate('volunteers', 'name').sort({ createdAt: -1 });
  if (level !== 'owner') {
    extra.assignments = assignments.map((a) => ({
      id: String(a._id),
      status: a.status,
      team: a.team ? { id: String((a.team as unknown as { _id: unknown })._id), name: (a.team as unknown as { name: string }).name } : null,
      volunteers: (a.volunteers as unknown as { _id: unknown; name: string }[]).map((v) => ({ id: String(v._id), name: v.name })),
      instructions: a.instructions,
      assignedAt: a.assignedAt,
      reassignReason: level === 'admin' ? a.reassignReason : undefined,
      progress: a.progress.map((p) => ({ note: p.note, percent: p.percent, at: p.at })),
    }));
  } else {
    extra.assignedTeams = assignments.filter((a) => a.status === 'active' && a.team).map((a) => ({ name: (a.team as unknown as { name: string }).name }));
  }
  if (level === 'admin') {
    const settings = await getSettings();
    const live = recommendPriority(em, settings.priority, settings.ackDeadlineSeconds);
    extra.liveRecommendation = live;
    extra.staffing = (await computeStaffing([em])).get(String(em._id));
    const ids = em.duplicateCandidates.map((c) => c.emergency);
    const others = ids.length ? await Emergency.find({ _id: { $in: ids } }).select('emergencyId type status description createdAt kind address location') : [];
    extra.duplicateDetails = others.map((o) => ({
      id: String(o._id),
      emergencyId: o.emergencyId,
      type: o.type,
      kind: o.kind,
      status: o.status,
      description: o.description,
      createdAt: o.createdAt,
      location: latLngOf(o.location),
    }));
  }
  return ok(res, serializeEmergency(em, level, extra));
});

export const getRecommendation = asyncHandler(async (req, res) => {
  const em = await Emergency.findById(req.params.id);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  const settings = await getSettings();
  return ok(res, {
    stored: em.recommendedPriority,
    live: recommendPriority(em, settings.priority, settings.ackDeadlineSeconds),
    final: em.finalPriority ?? null,
    thresholds: settings.priority.thresholds,
  });
});

export const getSuggestions = asyncHandler(async (req, res) => {
  const em = await Emergency.findById(req.params.id);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  return ok(res, await suggestForEmergency(em));
});

/* ------------------------------------------------------------------ */
/* Owner update + revision history (Feature 13)                         */
/* ------------------------------------------------------------------ */

export const updateEmergency = asyncHandler(async (req, res) => {
  const user = req.user!;
  const em = await Emergency.findById(req.params.id).populate('reporter', 'name email phone');
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  // Only the person who filed the report may change it - never another user, not even other citizens.
  if (!isOwner(em, user._id)) throw forbidden('FORBIDDEN_NOT_OWNER', 'You can only update your own reports');
  if (em.status === 'resolved') throw conflict('EMERGENCY_CLOSED', 'A resolved emergency can no longer be updated');

  const b = req.body;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = (field: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  };

  if (b.description !== undefined) {
    track('description', em.description, b.description);
    em.description = b.description;
  }
  if (b.affectedCount !== undefined) {
    track('affectedCount', em.affectedCount, b.affectedCount);
    em.affectedCount = b.affectedCount;
  }
  if (b.dangerToLife !== undefined) {
    track('dangerToLife', em.dangerToLife, b.dangerToLife);
    em.dangerToLife = b.dangerToLife;
  }
  if (b.severity !== undefined) {
    track('severity', em.severity, b.severity);
    em.severity = b.severity;
  }
  if (b.vulnerable !== undefined) {
    const prev = { ...JSON.parse(JSON.stringify(em.vulnerable)) };
    track('vulnerable', prev, b.vulnerable);
    em.vulnerable = b.vulnerable;
  }
  if (b.assistanceNeeds !== undefined) {
    track('assistanceNeeds', em.assistanceNeeds, b.assistanceNeeds);
    em.assistanceNeeds = b.assistanceNeeds;
  }
  if (b.contact !== undefined) {
    track('contact', { name: em.contact?.name, phone: em.contact?.phone }, b.contact);
    em.contact = { name: b.contact.name ?? em.contact?.name, phone: b.contact.phone ?? em.contact?.phone };
  }
  if (b.location !== undefined) {
    const prev = latLngOf(em.location);
    track('location', { ...prev, address: em.address }, b.location);
    em.location = pointFrom(b.location);
    em.address = b.location.address ?? em.address;
  }
  const newFiles = toAttachments(req);
  if (newFiles.length > 0) {
    track('evidence', em.evidence.length, em.evidence.length + newFiles.length);
    em.evidence.push(...newFiles);
  }

  if (Object.keys(changes).length === 0) throw badRequest('NO_CHANGES', 'Nothing changed');

  // Recalculate the recommendation when something that influences priority changed.
  const IMPORTANT = ['description', 'affectedCount', 'dangerToLife', 'severity', 'vulnerable', 'location'];
  const important = Object.keys(changes).some((k) => IMPORTANT.includes(k));
  let recalculated = false;
  if (important) {
    const settings = await getSettings();
    const levelChanged = await refreshRecommendation(em, settings);
    recalculated = true;
    // Final priority stays as decided until an authorised person confirms it again.
    if (levelChanged || em.finalPriority?.level) em.priorityReviewNeeded = true;
  }

  em.revisionCount += 1;
  await em.save();
  await EmergencyRevision.create({
    emergency: em._id,
    revision: em.revisionCount,
    editedBy: user._id,
    editorRole: user.role,
    changes,
    priorityRecalculated: recalculated,
  });

  if (['description', 'location'].some((k) => k in changes)) await detectDuplicates(em);

  const isSos = em.kind === 'sos';
  const audience = await assignedUserIds(em._id);
  await notifyRoles(['admin'], {
    type: isSos ? 'sos_updated' : 'emergency_updated',
    params: { emergencyId: em.emergencyId, fields: Object.keys(changes) },
    message: `${em.emergencyId} was updated by the reporter (${Object.keys(changes).join(', ')})`,
    link: `/admin/emergencies/${em._id}`,
    entityType: 'emergency',
    entityId: String(em._id),
  });
  await notifyUsers(audience, {
    type: isSos ? 'sos_updated' : 'emergency_updated',
    params: { emergencyId: em.emergencyId, fields: Object.keys(changes) },
    message: `${em.emergencyId} was updated by the reporter`,
    link: `/responder/emergencies/${em._id}`,
    entityType: 'emergency',
    entityId: String(em._id),
  });
  await emitEmergencyEvent(em, isSos ? 'sos:updated' : 'emergency:updated', { fields: Object.keys(changes) });
  return ok(res, serializeEmergency(em, 'owner'));
});

export const listRevisions = asyncHandler(async (req, res) => {
  const { em, level } = await loadForViewer(req);
  const revs = await EmergencyRevision.find({ emergency: em._id }).sort({ revision: -1 }).populate('editedBy', 'name');
  return ok(
    res,
    revs.map((r) => ({
      revision: r.revision,
      at: r.createdAt,
      editedBy: { name: (r.editedBy as unknown as { name?: string })?.name ?? null, role: r.editorRole },
      changes: level === 'responder' ? Object.keys(r.changes) : r.changes,
      priorityRecalculated: r.priorityRecalculated,
    })),
  );
});

/* ------------------------------------------------------------------ */
/* Admin decisions                                                     */
/* ------------------------------------------------------------------ */

export const changeStatus = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { em, level } = await loadForViewer(req);
  const { to, note } = req.body as { to: 'acknowledged' | 'in_progress'; note?: string };
  if (to === 'in_progress' && user.role !== 'admin' && level !== 'responder') throw forbidden('FORBIDDEN_RESOURCE');
  await transitionEmergency(em, to, user, note);
  if (user.role === 'admin') await audit(user, `emergency.${to}`, 'Emergency', em._id, { note }, req);
  if (to === 'acknowledged' && em.reporter) {
    await notifyUsers([String((em.reporter as unknown as { _id?: unknown })._id ?? em.reporter)], {
      type: 'emergency_acknowledged',
      params: { emergencyId: em.emergencyId },
      message: `Your report ${em.emergencyId} was acknowledged by the coordination team`,
      link: `/citizen/requests/${em._id}`,
      entityType: 'emergency',
      entityId: String(em._id),
    });
  }
  if (to === 'in_progress') {
    await notifyRoles(['admin'], {
      type: 'work_started',
      params: { emergencyId: em.emergencyId },
      message: `Work started on ${em.emergencyId}`,
      link: `/admin/emergencies/${em._id}`,
      entityType: 'emergency',
      entityId: String(em._id),
    });
  }
  return ok(res, serializeEmergency(em, level));
});

export const decidePriority = asyncHandler(async (req, res) => {
  const user = req.user!;
  const em = await Emergency.findById(req.params.id).populate('reporter', 'name email phone');
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  const { level, overrideReason } = req.body as { level: 'critical' | 'high' | 'medium' | 'low'; overrideReason?: string };
  const settings = await getSettings();
  // Decide against a fresh recommendation so the admin is always comparing with current facts.
  const live = recommendPriority(em, settings.priority, settings.ackDeadlineSeconds);
  const overridden = level !== live.level;
  if (overridden && !overrideReason) throw badRequest('OVERRIDE_REASON_REQUIRED', 'A reason is required when overriding the recommended priority', [{ path: 'overrideReason', code: 'override_reason_required' }]);

  em.recommendedPriority = { level: live.level, score: live.score, reasons: live.reasons, computedAt: new Date() };
  em.finalPriority = { level, decidedBy: user._id, decidedAt: new Date(), overridden, overrideReason: overridden ? overrideReason : undefined, recommendedLevelAtDecision: live.level };
  em.priorityReviewNeeded = false;
  await em.save();
  await audit(user, 'emergency.priority_confirm', 'Emergency', em._id, { final: level, recommended: live.level, overridden, overrideReason }, req);
  await emitEmergencyEvent(em, 'priority:confirmed', { level, overridden });
  const audience = await assignedUserIds(em._id);
  await notifyUsers(audience, {
    type: 'priority_confirmed',
    params: { emergencyId: em.emergencyId, level },
    message: `Priority of ${em.emergencyId} confirmed as ${level}`,
    link: `/responder/emergencies/${em._id}`,
    entityType: 'emergency',
    entityId: String(em._id),
  });
  return ok(res, serializeEmergency(em, 'admin'));
});

export const setRequirements = asyncHandler(async (req, res) => {
  const em = await Emergency.findById(req.params.id).populate('reporter', 'name email phone');
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  em.requiredVolunteers = req.body.requiredVolunteers;
  em.requiredSkills = req.body.requiredSkills;
  await em.save();
  await audit(req.user, 'emergency.requirements', 'Emergency', em._id, req.body, req);
  const staffing = (await computeStaffing([em])).get(String(em._id));
  await emitEmergencyEvent(em, 'emergency:updated', { fields: ['requirements'] });
  return ok(res, serializeEmergency(em, 'admin', { staffing }));
});

export const markSmsPrepared = asyncHandler(async (req, res) => {
  const { em } = await loadForViewer(req);
  if (!isOwner(em, req.user!._id)) throw forbidden('FORBIDDEN_NOT_OWNER');
  em.sms = { prepared: true, preparedAt: new Date(), note: req.body.note ?? 'SMS composer opened on the device; delivery is NOT confirmed.' };
  await em.save();
  return ok(res, { sms: em.sms });
});

/* ------------------------------------------------------------------ */
/* Duplicate review (never deletes or merges)                           */
/* ------------------------------------------------------------------ */

export const listDuplicatePairs = asyncHandler(async (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>);
  const match = status === 'all' ? { $exists: true } : status;
  const docs = await Emergency.find({ 'duplicateCandidates.reviewStatus': match }).sort({ createdAt: -1 }).limit(500);

  const seen = new Set<string>();
  const pairs: { key: string; a: EmergencyDoc; bId: string; cand: EmergencyDoc['duplicateCandidates'][number] }[] = [];
  for (const d of docs) {
    for (const c of d.duplicateCandidates) {
      if (status !== 'all' && c.reviewStatus !== status) continue;
      const key = [String(d._id), String(c.emergency)].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ key, a: d, bId: String(c.emergency), cand: c });
    }
  }
  const total = pairs.length;
  const pageItems = pairs.slice(skip, skip + limit);
  const others = await Emergency.find({ _id: { $in: pageItems.map((p) => p.bId) } });
  const brief = (e: EmergencyDoc) => ({
    id: String(e._id),
    emergencyId: e.emergencyId,
    kind: e.kind,
    type: e.type,
    status: e.status,
    description: e.description,
    affectedCount: e.affectedCount,
    address: e.address,
    location: latLngOf(e.location),
    createdAt: e.createdAt,
    duplicateOf: e.duplicateOf ? String(e.duplicateOf) : null,
  });
  return ok(
    res,
    pageItems.map((p) => {
      const b = others.find((o) => String(o._id) === p.bId);
      return {
        key: p.key,
        a: brief(p.a),
        b: b ? brief(b) : null,
        score: p.cand.score,
        reasons: p.cand.reasons,
        distanceMeters: p.cand.distanceMeters,
        similarity: p.cand.similarity,
        reviewStatus: p.cand.reviewStatus,
        reviewedAt: p.cand.reviewedAt,
        note: p.cand.note,
      };
    }),
    pageMeta(page, limit, total),
  );
});

export const reviewDuplicate = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { otherId, decision, note } = req.body as { otherId: string; decision: 'related' | 'confirmed_duplicate' | 'not_duplicate'; note?: string };
  if (otherId === req.params.id) throw badRequest('INVALID_PAIR', 'A report cannot be a duplicate of itself');
  const [a, b] = await Promise.all([Emergency.findById(req.params.id), Emergency.findById(otherId)]);
  if (!a || !b) throw notFound('EMERGENCY_NOT_FOUND');

  const stamp = (doc: EmergencyDoc, otherDocId: unknown) => {
    const c = doc.duplicateCandidates.find((x) => String(x.emergency) === String(otherDocId));
    if (!c) return false;
    c.reviewStatus = decision;
    c.reviewedBy = user._id;
    c.reviewedAt = new Date();
    c.note = note;
    return true;
  };
  const okA = stamp(a, b._id);
  const okB = stamp(b, a._id);
  if (!okA && !okB) throw notFound('DUPLICATE_PAIR_NOT_FOUND', 'These reports were not flagged as possible duplicates');
  // "a" is the report that is marked as the duplicate of "b". Both reports stay fully available.
  if (decision === 'confirmed_duplicate') a.duplicateOf = b._id;
  if (decision !== 'confirmed_duplicate' && a.duplicateOf && String(a.duplicateOf) === String(b._id)) a.duplicateOf = undefined;
  await Promise.all([a.save(), b.save()]);
  await audit(user, `duplicate.${decision}`, 'Emergency', a._id, { other: String(b._id), note }, req);
  emitToRoles(['admin'], 'emergency:updated', { id: String(a._id), emergencyId: a.emergencyId, fields: ['duplicates'] });
  return ok(res, { a: { id: String(a._id), duplicateOf: a.duplicateOf ? String(a.duplicateOf) : null }, b: { id: String(b._id) }, decision });
});

export { effectivePriority };
