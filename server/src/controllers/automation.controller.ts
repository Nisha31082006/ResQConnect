import { Emergency, EmergencyZone, Escalation, FollowUp, ResourceAlert, Shelter, ShelterReferral, User } from '../models';
import { audit } from '../services/audit.service';
import { emitEmergencyEvent } from '../services/emergency.service';
import { notifyUsers } from '../services/notification.service';
import { getSettings } from '../services/settings.service';
import { recommendForEmergency, recommendationsOverview, teamsNeedingMembers } from '../services/automation/teamFormation';
import { workloadReport } from '../services/automation/workload';
import { recommendShelters, shelterOverview } from '../services/automation/shelters';
import { evaluateResources, serializeAlert } from '../services/automation/resources';
import { serializeZone } from '../services/automation/zones';
import { remindNow, serializeFollowUp } from '../services/automation/followUps';
import { runAutomation } from '../services/automation/runner';
import { addMembersToTeam } from './teams.controller';
import { performAssignment } from './assignments.controller';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { latLngOf } from '../utils/geo';
import { asyncHandler, created, ok } from '../utils/http';
import { emitToRoles } from '../sockets';

const loadEmergency = async (id: string) => {
  const em = await Emergency.findById(id);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  return em;
};

/* ---------------- overview (Smart Automation Dashboard) ---------------- */

async function unacknowledgedSos() {
  const settings = await getSettings();
  const pending = await Emergency.find({ kind: 'sos', status: 'pending' }).sort({ createdAt: 1 }).limit(50);
  const escs = pending.length ? await Escalation.find({ emergency: { $in: pending.map((p) => p._id) } }) : [];
  const now = Date.now();
  return {
    deadlineSeconds: settings.ackDeadlineSeconds,
    items: pending.map((e) => {
      const waited = Math.floor((now - e.createdAt.getTime()) / 1000);
      const mine = escs.filter((x) => String(x.emergency) === String(e._id));
      return {
        id: String(e._id),
        emergencyId: e.emergencyId,
        type: e.type,
        affectedCount: e.affectedCount,
        address: e.address ?? null,
        waitedSeconds: waited,
        overdue: waited >= settings.ackDeadlineSeconds,
        escalationLevel: mine.length ? Math.max(...mine.map((x) => x.level)) : 0,
        openEscalations: mine.filter((x) => x.status === 'open').length,
      };
    }),
  };
}

async function followUpRows(status: string, kind?: string) {
  const filter: Record<string, unknown> = { status };
  if (kind) filter.kind = kind;
  const rows = await FollowUp.find(filter).sort({ idleMinutes: -1 }).limit(100);
  const ids = [...new Set(rows.flatMap((r) => r.assignees.map(String)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name') : [];
  return rows.map((r) => serializeFollowUp(r, r.assignees.map((a) => users.find((u) => String(u._id) === String(a))?.name ?? '?')));
}

export const overview = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const cfg = settings.automation;
  const [recs, teamGaps, workload, zones, alerts, shelters, sos, followUps, resources] = await Promise.all([
    recommendationsOverview(cfg),
    teamsNeedingMembers(cfg),
    workloadReport(cfg),
    EmergencyZone.find({ status: { $in: ['detected', 'reviewed'] } }).sort({ lastDetectedAt: -1 }).limit(50),
    ResourceAlert.find({ status: 'open' }).sort({ severity: 1, lastDetectedAt: -1 }).limit(50),
    shelterOverview(cfg),
    unacknowledgedSos(),
    followUpRows('open'),
    evaluateResources(cfg),
  ]);
  return ok(res, {
    generatedAt: new Date(),
    config: cfg,
    summary: {
      emergenciesNeedingTeams: recs.total,
      teamsNeedingMembers: teamGaps.length,
      overloadedVolunteers: workload.summary.overloaded,
      availableVolunteers: workload.summary.available,
      zonesToReview: zones.filter((z) => z.status === 'detected').length,
      criticalShortages: alerts.filter((a) => a.severity === 'critical').length,
      openShortages: alerts.length,
      shelterRecommendations: shelters.total,
      unacknowledgedSos: sos.items.length,
      overdueSos: sos.items.filter((s) => s.overdue).length,
      pendingFollowUps: followUps.length,
    },
    teamRecommendations: recs,
    teamsNeedingMembers: teamGaps,
    workload: { summary: workload.summary, volunteers: workload.volunteers },
    zones: zones.map((z) => serializeZone(z)),
    resourceAlerts: alerts.map(serializeAlert),
    resources: resources.snapshot,
    shelterRecommendations: shelters,
    unacknowledgedSos: sos,
    followUps,
  });
});

export const runChecks = asyncHandler(async (req, res) => {
  const result = await runAutomation();
  await audit(req.user, 'automation.run', 'Automation', 'manual', { errors: result.errors.length }, req);
  return ok(res, result);
});

/* ---------------- 1. team formation ---------------- */

export const teamRecommendations = asyncHandler(async (_req, res) => ok(res, await recommendationsOverview((await getSettings()).automation, 20)));

export const teamRecommendationFor = asyncHandler(async (req, res) => {
  const em = await loadEmergency(req.params.id);
  return ok(res, await recommendForEmergency(em, (await getSettings()).automation));
});

export const teamGaps = asyncHandler(async (_req, res) => ok(res, await teamsNeedingMembers((await getSettings()).automation)));

/**
 * The admin APPROVES a (possibly edited) formation. Only now is anything created: optionally the approved volunteers
 * join an existing team, then the assignment is made through the normal assignment rules. Automation never dispatches.
 */
export const approveFormation = asyncHandler(async (req, res) => {
  const { emergencyId, teamId, volunteerIds, addToTeam, instructions } = req.body as { emergencyId: string; teamId?: string; volunteerIds: string[]; addToTeam: boolean; instructions?: string };
  const user = req.user!;
  const em = await loadEmergency(emergencyId);
  if (em.status === 'resolved') throw conflict('EMERGENCY_CLOSED', 'This emergency is resolved');
  const loads = (await workloadReport((await getSettings()).automation)).volunteers;
  for (const id of volunteerIds) {
    const l = loads.find((v) => v.id === id);
    if (!l) throw badRequest('VOLUNTEER_NOT_FOUND', 'One or more volunteers are invalid or inactive');
    if (l.state === 'unavailable') throw conflict('VOLUNTEER_UNAVAILABLE', `${l.name} is marked unavailable`);
  }
  if (addToTeam) {
    if (!teamId) throw badRequest('TEAM_REQUIRED', 'Choose a team to add the approved volunteers to');
    await addMembersToTeam(teamId, volunteerIds, user, req);
  }
  const r = await performAssignment(user, { emergencyId, teamId, volunteerIds: addToTeam ? [] : volunteerIds, instructions }, req);
  await audit(user, 'automation.team_formation.approve', 'Emergency', em._id, { teamId, volunteerIds, addToTeam }, req);
  emitToRoles(['admin'], 'automation:updated', { area: 'teams' });
  return created(res, r.assignment, { staffing: r.staffing });
});

/* ---------------- 3. zones ---------------- */

export const listZones = asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const filter = status ? { status } : { status: { $in: ['detected', 'reviewed'] } };
  const zones = await EmergencyZone.find(filter).sort({ lastDetectedAt: -1 }).limit(100);
  return ok(res, zones.map((z) => serializeZone(z)));
});

export const getZone = asyncHandler(async (req, res) => {
  const z = await EmergencyZone.findById(req.params.id);
  if (!z) throw notFound('ZONE_NOT_FOUND');
  const ems = await Emergency.find({ _id: { $in: z.emergencies } }).select('emergencyId type affectedCount status kind location createdAt');
  return ok(
    res,
    serializeZone(
      z,
      ems.map((e) => ({ id: String(e._id), emergencyId: e.emergencyId, type: e.type, affectedCount: e.affectedCount, status: e.status, kind: e.kind, lat: latLngOf(e.location)?.lat, lng: latLngOf(e.location)?.lng })),
    ),
  );
});

export const reviewZone = asyncHandler(async (req, res) => {
  const z = await EmergencyZone.findById(req.params.id);
  if (!z) throw notFound('ZONE_NOT_FOUND');
  if (z.status === 'inactive') throw conflict('ZONE_INACTIVE', 'This zone is no longer active');
  const { decision, note } = req.body as { decision: 'reviewed' | 'dismissed'; note?: string };
  z.status = decision;
  z.reviewedBy = req.user!._id;
  z.reviewedAt = new Date();
  z.reviewNote = note;
  await z.save();
  await audit(req.user, 'automation.zone.review', 'EmergencyZone', z._id, { decision, note }, req);
  emitToRoles(['admin'], 'automation:updated', { area: 'zones' });
  return ok(res, serializeZone(z));
});

/* ---------------- 2. resources ---------------- */

export const listResourceAlerts = asyncHandler(async (req, res) => {
  const status = (req.query.status as string) || 'open';
  const rows = await ResourceAlert.find({ status }).sort({ severity: 1, lastDetectedAt: -1 }).limit(100);
  const { snapshot } = await evaluateResources((await getSettings()).automation);
  return ok(res, { snapshot, alerts: rows.map(serializeAlert) });
});

export const acknowledgeAlert = asyncHandler(async (req, res) => {
  const a = await ResourceAlert.findById(req.params.id);
  if (!a) throw notFound('ALERT_NOT_FOUND');
  a.acknowledgedBy = req.user!._id;
  a.acknowledgedAt = new Date();
  await a.save();
  await audit(req.user, 'automation.alert.acknowledge', 'ResourceAlert', a._id, {}, req);
  return ok(res, serializeAlert(a));
});

/* ---------------- 4. shelters ---------------- */

export const shelterRecommendations = asyncHandler(async (_req, res) => ok(res, await shelterOverview((await getSettings()).automation, 20)));

export const shelterRecommendationFor = asyncHandler(async (req, res) => {
  const em = await loadEmergency(req.params.id);
  const people = req.query.people ? Number(req.query.people) : undefined;
  return ok(res, await recommendShelters(em, (await getSettings()).automation, people));
});

/**
 * Admin confirms ONE suggested shelter. This records an approved referral (reserving places) - nobody is registered:
 * the shelter coordinator still has to confirm arrival, which is what updates occupancy.
 */
export const confirmShelter = asyncHandler(async (req, res) => {
  const em = await loadEmergency(req.params.id);
  const { shelterId, people, note } = req.body as { shelterId: string; people?: number; note?: string };
  if (em.status === 'resolved') throw conflict('EMERGENCY_CLOSED', 'This emergency is resolved');
  if (em.shelterPlan?.shelter) throw conflict('SHELTER_ALREADY_PLANNED', 'A shelter was already confirmed for this emergency');
  const n = people ?? em.affectedCount;
  const rec = await recommendShelters(em, (await getSettings()).automation, n);
  const match = rec.shelters.find((s) => s.id === shelterId);
  if (!match) {
    const s = await Shelter.findById(shelterId);
    if (!s) throw notFound('SHELTER_NOT_FOUND');
    throw badRequest('SHELTER_NOT_SUITABLE', 'This shelter is closed, too far or has insufficient free places for this emergency');
  }
  const shelter = (await Shelter.findById(shelterId))!;
  const referral = await ShelterReferral.create({ shelter: shelter._id, emergency: em._id, people: n, approvedBy: req.user!._id, note });
  em.shelterPlan = { shelter: shelter._id, referral: referral._id, people: n, confirmedBy: req.user!._id, confirmedAt: new Date() };
  await em.save();
  if (shelter.coordinator) {
    await notifyUsers([shelter.coordinator], { type: 'shelter_referral', params: { shelter: shelter.name, people: n }, message: `${n} people referred to ${shelter.name}`, link: '/shelter/profile', entityType: 'shelter', entityId: String(shelter._id) });
  }
  await audit(req.user, 'automation.shelter.confirm', 'Emergency', em._id, { shelter: shelter.name, people: n, referral: String(referral._id) }, req);
  await emitEmergencyEvent(em, 'emergency:updated');
  emitToRoles(['admin'], 'automation:updated', { area: 'shelters' });
  return created(res, { emergencyId: em.emergencyId, shelter: { id: String(shelter._id), name: shelter.name }, referralId: String(referral._id), people: n, status: 'referred' });
});

/* ---------------- 7. workload ---------------- */

export const workload = asyncHandler(async (req, res) => {
  const report = await workloadReport((await getSettings()).automation);
  const state = req.query.state as string | undefined;
  return ok(res, { summary: report.summary, volunteers: state ? report.volunteers.filter((v) => v.state === state) : report.volunteers });
});

/* ---------------- 6. SOS ---------------- */

export const sosMonitor = asyncHandler(async (_req, res) => ok(res, await unacknowledgedSos()));

/* ---------------- 8. follow-ups ---------------- */

export const listFollowUps = asyncHandler(async (req, res) => ok(res, await followUpRows((req.query.status as string) || 'open', req.query.kind as string | undefined)));

export const remindFollowUp = asyncHandler(async (req, res) => {
  const fu = await remindNow(req.params.id);
  if (!fu) throw notFound('FOLLOWUP_NOT_FOUND', 'Follow-up not found or already closed');
  await audit(req.user, 'automation.followup.remind', 'FollowUp', fu._id, {}, req);
  return ok(res, serializeFollowUp(fu));
});

export const dismissFollowUp = asyncHandler(async (req, res) => {
  const fu = await FollowUp.findById(req.params.id);
  if (!fu || fu.status !== 'open') throw notFound('FOLLOWUP_NOT_FOUND', 'Follow-up not found or already closed');
  fu.status = 'dismissed';
  fu.completedAt = new Date();
  fu.completionReason = 'admin_dismissed';
  await fu.save();
  await audit(req.user, 'automation.followup.dismiss', 'FollowUp', fu._id, {}, req);
  emitToRoles(['admin'], 'automation:updated', { area: 'followups' });
  return ok(res, serializeFollowUp(fu));
});

