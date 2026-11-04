import { Assignment, Emergency, EmergencyRevision, FollowUp, RescueTeam, Shelter, User } from '../../models';
import type { IFollowUp } from '../../models/FollowUp';
import { emitToRoles } from '../../sockets';
import type { AutomationConfig } from '../settings.service';
import { notifyRoles, notifyUsers } from '../notification.service';

const minutesBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 60000);
const latest = (...d: (Date | undefined | null)[]) => d.filter((x): x is Date => Boolean(x)).reduce((m, x) => (x > m ? x : m), new Date(0));

interface Candidate {
  key: string;
  kind: IFollowUp['kind'];
  emergency?: unknown;
  assignment?: unknown;
  shelter?: unknown;
  assignees: unknown[];
  label: string;
  idleMinutes: number;
  link: string;
}

/** Conditions that currently need a follow-up, read from real data. Pure reads, no writes. */
export async function evaluateFollowUps(cfg: AutomationConfig, now: Date = new Date()): Promise<Candidate[]> {
  const f = cfg.followUp;
  const out: Candidate[] = [];

  // 1. Pending / acknowledged emergencies with no update (status change, revision) for too long.
  const waiting = await Emergency.find({ status: { $in: ['pending', 'acknowledged'] }, createdAt: { $lte: new Date(now.getTime() - f.emergencyIdleMinutes * 60000) } });
  const revs = waiting.length ? await EmergencyRevision.find({ emergency: { $in: waiting.map((e) => e._id) } }).sort({ createdAt: -1 }).select('emergency createdAt') : [];
  for (const e of waiting) {
    const rev = revs.find((r) => String(r.emergency) === String(e._id));
    const last = latest(e.createdAt, e.acknowledgedAt, e.statusHistory[e.statusHistory.length - 1]?.at, rev?.createdAt);
    const idle = minutesBetween(now, last);
    if (idle >= f.emergencyIdleMinutes) out.push({ key: `emergency_update:${e._id}`, kind: 'emergency_update', emergency: e._id, assignees: [], label: e.emergencyId, idleMinutes: idle, link: `/admin/emergencies/${e._id}` });
  }

  // 2. Active rescue work with no progress note: remind the team leader.
  const active = await Assignment.find({ status: 'active' });
  const ems = await Emergency.find({ _id: { $in: active.map((a) => a.emergency) }, status: { $in: ['assigned', 'in_progress'] } });
  const teams = await RescueTeam.find({ _id: { $in: active.filter((a) => a.team).map((a) => a.team) } });
  for (const a of active) {
    const e = ems.find((x) => String(x._id) === String(a.emergency));
    if (!e) continue;
    const last = latest(a.assignedAt, a.progress[a.progress.length - 1]?.at, e.statusHistory[e.statusHistory.length - 1]?.at);
    const idle = minutesBetween(now, last);
    if (idle < f.progressIdleMinutes) continue;
    const team = teams.find((t) => a.team && String(t._id) === String(a.team));
    let assignees: unknown[] = team ? [team.leader] : [];
    if (!assignees.length && a.volunteers.length) {
      const leads = await User.find({ _id: { $in: a.volunteers }, role: 'team_leader' }).select('_id');
      assignees = (leads.length ? leads.map((l) => l._id) : a.volunteers);
    }
    out.push({ key: `rescue_progress:${a._id}`, kind: 'rescue_progress', emergency: e._id, assignment: a._id, assignees, label: `${e.emergencyId}${team ? ` / ${team.name}` : ''}`, idleMinutes: idle, link: `/admin/emergencies/${e._id}` });
  }

  // 3. Shelters whose occupancy has not been refreshed.
  const shelters = await Shelter.find({ status: { $ne: 'closed' } });
  for (const s of shelters) {
    const idle = minutesBetween(now, latest(s.occupancyUpdatedAt, s.createdAt));
    if (idle >= f.shelterStaleMinutes) out.push({ key: `shelter_occupancy:${s._id}`, kind: 'shelter_occupancy', shelter: s._id, assignees: s.coordinator ? [s.coordinator] : [], label: s.name, idleMinutes: idle, link: '/admin/shelters' });
  }
  return out;
}

const REMINDER_TEXT: Record<IFollowUp['kind'], string> = {
  emergency_update: 'has had no update',
  rescue_progress: 'needs a rescue progress update',
  shelter_occupancy: 'needs an occupancy refresh',
};

async function remind(fu: InstanceType<typeof FollowUp>, link: string, now: Date) {
  const params = { label: fu.label, idleMinutes: fu.idleMinutes, kind: fu.kind };
  const input = { type: `followup_${fu.kind}`, params, message: `${fu.label} ${REMINDER_TEXT[fu.kind]} (${fu.idleMinutes} min)`, entityType: 'followup', entityId: String(fu._id) };
  if (fu.assignees.length) {
    const target = fu.kind === 'shelter_occupancy' ? '/shelter/profile' : fu.kind === 'rescue_progress' ? '/responder' : link;
    await notifyUsers(fu.assignees, { ...input, link: target });
  } else {
    await notifyRoles(['admin'], { ...input, link });
  }
  fu.reminderCount += 1;
  fu.lastRemindedAt = now;
  await fu.save();
  emitToRoles(['admin'], 'followup:reminder', { id: String(fu._id), kind: fu.kind });
}

/** Create / refresh follow-ups, send due reminders (at most one per repeat interval, capped) and close satisfied ones. */
export async function syncFollowUps(cfg: AutomationConfig, now: Date = new Date()) {
  const candidates = await evaluateFollowUps(cfg, now);
  const open = await FollowUp.find({ status: 'open' });
  let created = 0;
  let reminders = 0;
  let completed = 0;
  const f = cfg.followUp;

  for (const c of candidates) {
    const link = c.link;
    let fu = open.find((o) => o.key === c.key);
    if (!fu) {
      // An admin dismissal pauses a follow-up for one repeat interval.
      const dismissed = await FollowUp.findOne({ key: c.key, status: 'dismissed' }).sort({ updatedAt: -1 });
      if (dismissed && minutesBetween(now, dismissed.updatedAt) < f.repeatMinutes) continue;
      fu = await FollowUp.create({ key: c.key, kind: c.kind, status: 'open', emergency: c.emergency, assignment: c.assignment, shelter: c.shelter, assignees: c.assignees, label: c.label, idleMinutes: c.idleMinutes });
      created += 1;
      await remind(fu, link, now);
      reminders += 1;
      if (fu.assignees.length) await notifyRoles(['admin'], { type: 'followup_created', params: { label: fu.label, kind: fu.kind }, message: `Follow-up opened: ${fu.label}`, link: '/admin/automation', entityType: 'followup', entityId: String(fu._id) });
      emitToRoles(['admin'], 'followup:created', { id: String(fu._id), kind: fu.kind });
      continue;
    }
    fu.idleMinutes = c.idleMinutes;
    fu.assignees = c.assignees as typeof fu.assignees;
    const due = !fu.lastRemindedAt || minutesBetween(now, fu.lastRemindedAt) >= f.repeatMinutes;
    if (due && fu.reminderCount < f.maxReminders) {
      await remind(fu, link, now);
      reminders += 1;
    } else await fu.save();
  }
  for (const o of open) {
    if (candidates.some((c) => c.key === o.key)) continue;
    o.status = 'completed';
    o.completedAt = now;
    o.completionReason = 'updated';
    await o.save();
    completed += 1;
  }
  if (created || completed || reminders) emitToRoles(['admin'], 'automation:updated', { area: 'followups' });
  return { created, reminders, completed, open: candidates.length };
}

export async function remindNow(id: string, now: Date = new Date()) {
  const fu = await FollowUp.findById(id);
  if (!fu || fu.status !== 'open') return null;
  await remind(fu, fu.emergency ? `/admin/emergencies/${fu.emergency}` : '/admin/automation', now);
  return fu;
}

export const serializeFollowUp = (f: InstanceType<typeof FollowUp>, assigneeNames: string[] = []) => ({
  id: String(f._id),
  kind: f.kind,
  status: f.status,
  label: f.label,
  idleMinutes: f.idleMinutes,
  reminderCount: f.reminderCount,
  lastRemindedAt: f.lastRemindedAt,
  createdAt: f.createdAt,
  emergencyId: f.emergency ? String(f.emergency) : null,
  shelterId: f.shelter ? String(f.shelter) : null,
  assignees: assigneeNames,
  completedAt: f.completedAt,
  completionReason: f.completionReason,
});
