import { Types, type FilterQuery } from 'mongoose';
import { Assignment, Emergency, TeamMembership } from '../models';
import type { EmergencyDoc, IEmergency } from '../models/Emergency';
import type { UserDoc } from '../models/User';
import type { EmergencyStatus, Role } from '../models/shared';
import { AppError, conflict, forbidden } from '../utils/AppError';
import { approximate, latLngOf } from '../utils/geo';
import { generateEmergencyId, idOf } from '../utils/ids';
import { emitToRoles, emitToTeams, emitToUser, emitMapRefresh } from '../sockets';
import { recommendPriority } from './priority.service';
import { getSettings, type AppSettings } from './settings.service';
import { resolveEscalationsFor } from './escalation.service';

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

export const TRANSITIONS: Record<EmergencyStatus, { to: EmergencyStatus; roles: Role[] }[]> = {
  pending: [{ to: 'acknowledged', roles: ['admin'] }],
  acknowledged: [{ to: 'assigned', roles: ['admin'] }],
  assigned: [{ to: 'in_progress', roles: ['admin', 'team_leader', 'volunteer'] }],
  in_progress: [{ to: 'completion_submitted', roles: ['team_leader'] }],
  completion_submitted: [{ to: 'admin_verification', roles: ['admin'] }],
  admin_verification: [
    { to: 'resolved', roles: ['admin'] },
    { to: 'in_progress', roles: ['admin'] }, // rejected completion goes back for more work
  ],
  resolved: [],
};

/** Throws unless `role` may move an emergency from `from` to `to`. Exported for unit tests. */
export function assertTransition(from: EmergencyStatus, to: EmergencyStatus, role: Role): void {
  const rule = TRANSITIONS[from]?.find((t) => t.to === to);
  if (!rule) throw conflict('INVALID_TRANSITION', `Cannot change status from "${from}" to "${to}"`, { from, to });
  if (!rule.roles.includes(role)) throw forbidden('TRANSITION_NOT_ALLOWED', `Role "${role}" cannot change status from "${from}" to "${to}"`);
}

export async function transitionEmergency(em: EmergencyDoc, to: EmergencyStatus, actor: UserDoc, note?: string): Promise<EmergencyDoc> {
  assertTransition(em.status, to, actor.role);
  const from = em.status;
  em.status = to;
  em.statusHistory.push({ from, to, by: actor._id, byRole: actor.role, at: new Date(), note });
  if (to === 'acknowledged') {
    em.acknowledgedAt = new Date();
    em.acknowledgedBy = actor._id;
  }
  if (to === 'resolved') em.resolvedAt = new Date();
  await refreshRecommendation(em);
  await em.save();
  if (to === 'acknowledged') await resolveEscalationsFor(em._id);
  await emitEmergencyEvent(em, 'emergency:status', { from, to });
  return em;
}

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

export async function refreshRecommendation(em: EmergencyDoc, settings?: AppSettings): Promise<boolean> {
  const s = settings ?? (await getSettings());
  const previous = em.recommendedPriority?.level;
  const rec = recommendPriority(em, s.priority, s.ackDeadlineSeconds);
  em.recommendedPriority = { level: rec.level, score: rec.score, reasons: rec.reasons, computedAt: new Date() };
  return previous !== undefined && previous !== rec.level;
}

export const effectivePriority = (em: Pick<IEmergency, 'recommendedPriority' | 'finalPriority'>) => ({
  level: em.finalPriority?.level ?? em.recommendedPriority.level,
  confirmed: Boolean(em.finalPriority?.level),
});

/* ------------------------------------------------------------------ */
/* Creation (idempotent)                                               */
/* ------------------------------------------------------------------ */

export async function createEmergencyDoc(input: Partial<IEmergency> & { kind: 'normal' | 'sos' }): Promise<EmergencyDoc> {
  const settings = await getSettings();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const em = new Emergency({ ...input, emergencyId: generateEmergencyId(), status: 'pending' });
    em.statusHistory.push({ to: 'pending', by: input.reporter, byRole: 'citizen', at: new Date(), note: 'created' });
    const rec = recommendPriority(em, settings.priority, settings.ackDeadlineSeconds);
    em.recommendedPriority = { level: rec.level, score: rec.score, reasons: rec.reasons, computedAt: new Date() };
    try {
      await em.save();
      return em;
    } catch (err) {
      const e = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (e.code === 11000 && e.keyPattern && 'emergencyId' in e.keyPattern) continue; // ID collision: retry with a new ID
      throw err;
    }
  }
  throw new AppError(500, 'ID_GENERATION_FAILED', 'Could not generate a unique emergency ID');
}

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

export async function getUserTeamIds(userId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
  const m = await TeamMembership.find({ user: userId, active: true }).select('team');
  return m.map((x) => x.team);
}

/** Emergencies a responder (volunteer/team leader) may see: those with an ACTIVE assignment to their team or to them directly. */
export async function responderEmergencyIds(user: UserDoc): Promise<Types.ObjectId[]> {
  const teamIds = await getUserTeamIds(user._id);
  const assignments = await Assignment.find({
    status: 'active',
    $or: [{ team: { $in: teamIds } }, { volunteers: user._id }],
  }).select('emergency');
  return assignments.map((a) => a.emergency);
}

/** Mongo filter limiting which emergencies a user may list; `null` means the role has no access at all. */
export async function emergencyScope(user: UserDoc): Promise<FilterQuery<IEmergency> | null> {
  switch (user.role) {
    case 'admin':
      return {};
    case 'citizen':
      return { reporter: user._id };
    case 'volunteer':
    case 'team_leader':
      return { _id: { $in: await responderEmergencyIds(user) } };
    default:
      return null;
  }
}

export type ViewLevel = 'admin' | 'owner' | 'responder';

export async function viewLevelFor(user: UserDoc, em: EmergencyDoc): Promise<ViewLevel | null> {
  if (user.role === 'admin') return 'admin';
  if (em.reporter && idOf(em.reporter) === String(user._id)) return 'owner';
  if (user.role === 'volunteer' || user.role === 'team_leader') {
    const ids = await responderEmergencyIds(user);
    if (ids.some((id) => String(id) === String(em._id))) return 'responder';
  }
  return null;
}

const publicFile = (name: string) => `/api/uploads/${name}`;

export function serializeEmergency(em: EmergencyDoc, level: ViewLevel, extra: Record<string, unknown> = {}) {
  const ll = latLngOf(em.location);
  const reporter = em.reporter as unknown as { _id?: Types.ObjectId; name?: string; email?: string; phone?: string } | Types.ObjectId | undefined;
  const populatedReporter = reporter && typeof reporter === 'object' && 'name' in reporter ? reporter : undefined;
  const fp = em.finalPriority?.level
    ? {
        level: em.finalPriority.level,
        overridden: Boolean(em.finalPriority.overridden),
        decidedAt: em.finalPriority.decidedAt,
        recommendedLevelAtDecision: em.finalPriority.recommendedLevelAtDecision,
        ...(level === 'admin' ? { overrideReason: em.finalPriority.overrideReason, decidedBy: em.finalPriority.decidedBy } : {}),
      }
    : null;

  return {
    id: String(em._id),
    emergencyId: em.emergencyId,
    kind: em.kind,
    source: em.source,
    type: em.type,
    description: em.description,
    affectedCount: em.affectedCount,
    dangerToLife: em.dangerToLife,
    severity: em.severity,
    vulnerable: em.vulnerable,
    assistanceNeeds: em.assistanceNeeds,
    contact: em.contact,
    location: ll ? { ...ll, address: em.address } : null,
    occurredAt: em.occurredAt,
    evidence: em.evidence.map((e) => ({ filename: e.filename, originalName: e.originalName, mimeType: e.mimeType, size: e.size, url: publicFile(e.filename) })),
    status: em.status,
    statusHistory: em.statusHistory.map((h) => ({ from: h.from, to: h.to, byRole: h.byRole, at: h.at, note: h.note })),
    acknowledgedAt: em.acknowledgedAt,
    resolvedAt: em.resolvedAt,
    recommendedPriority: em.recommendedPriority,
    finalPriority: fp,
    effectivePriority: effectivePriority(em),
    priorityReviewNeeded: em.priorityReviewNeeded,
    requiredVolunteers: em.requiredVolunteers,
    requiredSkills: em.requiredSkills,
    revisionCount: em.revisionCount,
    sms: em.sms,
    createdAt: em.createdAt,
    updatedAt: em.updatedAt,
    ...(level === 'admin'
      ? {
          reporter: populatedReporter
            ? { id: String(populatedReporter._id), name: populatedReporter.name, email: populatedReporter.email, phone: populatedReporter.phone }
            : reporter
              ? { id: String(reporter) }
              : null,
          duplicateOf: em.duplicateOf ? String(em.duplicateOf) : null,
          duplicateCandidates: em.duplicateCandidates.map((c) => ({
            emergency: String(c.emergency),
            score: c.score,
            reasons: c.reasons,
            distanceMeters: c.distanceMeters,
            similarity: c.similarity,
            reviewStatus: c.reviewStatus,
            reviewedAt: c.reviewedAt,
            note: c.note,
            detectedAt: c.detectedAt,
          })),
        }
      : {}),
    ...extra,
  };
}

/** Role-based map projection: exact coordinates only for people who legitimately need them. */
export function mapPoint(em: EmergencyDoc, viewer: 'exact' | 'approximate') {
  const ll = latLngOf(em.location);
  if (!ll) return null;
  return viewer === 'exact' ? ll : approximate(ll);
}

/* ------------------------------------------------------------------ */
/* Staffing                                                            */
/* ------------------------------------------------------------------ */

export interface Staffing {
  required: number;
  assigned: number;
  gap: number;
  teams: string[];
}

export async function computeStaffing(ems: Pick<EmergencyDoc, '_id' | 'requiredVolunteers'>[]): Promise<Map<string, Staffing>> {
  const out = new Map<string, Staffing>();
  if (ems.length === 0) return out;
  const assignments = await Assignment.find({ emergency: { $in: ems.map((e) => e._id) }, status: 'active' });
  const teamIds = [...new Set(assignments.filter((a) => a.team).map((a) => String(a.team)))];
  const memberships = teamIds.length ? await TeamMembership.find({ team: { $in: teamIds }, active: true }).select('team') : [];
  const sizes = new Map<string, number>();
  memberships.forEach((m) => sizes.set(String(m.team), (sizes.get(String(m.team)) ?? 0) + 1));

  for (const e of ems) {
    const mine = assignments.filter((a) => String(a.emergency) === String(e._id));
    const assigned = mine.reduce((sum, a) => sum + (a.team ? sizes.get(String(a.team)) ?? 0 : 0) + a.volunteers.length, 0);
    out.set(String(e._id), {
      required: e.requiredVolunteers,
      assigned,
      gap: Math.max(0, e.requiredVolunteers - assigned),
      teams: mine.filter((a) => a.team).map((a) => String(a.team)),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Real-time                                                           */
/* ------------------------------------------------------------------ */

/**
 * Notify the audience of an emergency: admins, the reporter and the assigned teams.
 * Payloads are deliberately minimal (no contact details or coordinates); clients re-fetch via REST with their permissions.
 */
export async function emitEmergencyEvent(em: EmergencyDoc, event: string, extra: Record<string, unknown> = {}): Promise<void> {
  const payload = {
    id: String(em._id),
    emergencyId: em.emergencyId,
    kind: em.kind,
    type: em.type,
    status: em.status,
    priority: effectivePriority(em).level,
    updatedAt: em.updatedAt,
    ...extra,
  };
  emitToRoles(['admin'], event, payload);
  if (em.reporter) emitToUser(idOf(em.reporter), event, payload);
  const assignments = await Assignment.find({ emergency: em._id, status: 'active' }).select('team volunteers');
  const teamIds = assignments.filter((a) => a.team).map((a) => String(a.team));
  emitToTeams(teamIds, event, payload);
  assignments.forEach((a) => a.volunteers.forEach((v) => emitToUser(String(v), event, payload)));
  emitMapRefresh('emergency', String(em._id));
}
