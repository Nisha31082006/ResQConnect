import type { FilterQuery } from 'mongoose';
import { Emergency, Escalation } from '../models';
import type { IEscalation } from '../models/Escalation';
import { audit } from '../services/audit.service';
import { runEscalationCheck } from '../services/escalation.service';
import { getSettings } from '../services/settings.service';
import { conflict, notFound } from '../utils/AppError';
import { asyncHandler, ok, pageMeta, parsePaging } from '../utils/http';
import { emitToRoles } from '../sockets';

const serialize = (e: InstanceType<typeof Escalation>, em?: { _id: unknown; emergencyId: string; type: string; description: string; createdAt: Date; status: string; affectedCount: number } | null) => ({
  id: String(e._id),
  level: e.level,
  status: e.status,
  triggeredAt: e.triggeredAt,
  waitedSecondsAtTrigger: e.waitedSecondsAtTrigger,
  deadlineSeconds: e.deadlineSeconds,
  acknowledgedAt: e.acknowledgedAt,
  resolvedAt: e.resolvedAt,
  resolution: e.resolution,
  note: e.note,
  // Live elapsed time for the dashboard (still waiting if the SOS is unacknowledged).
  elapsedSeconds: em ? Math.floor((Date.now() - em.createdAt.getTime()) / 1000) : e.waitedSecondsAtTrigger,
  emergency: em ? { id: String(em._id), emergencyId: em.emergencyId, type: em.type, description: em.description, status: em.status, affectedCount: em.affectedCount, createdAt: em.createdAt } : null,
});

export const listEscalations = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>);
  const filter: FilterQuery<IEscalation> = {};
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([Escalation.find(filter).sort({ triggeredAt: -1 }).skip(skip).limit(limit), Escalation.countDocuments(filter)]);
  const ems = await Emergency.find({ _id: { $in: items.map((i) => i.emergency) } }).select('emergencyId type description createdAt status affectedCount');
  return ok(res, items.map((e) => serialize(e, ems.find((m) => String(m._id) === String(e.emergency)))), pageMeta(page, limit, total));
});

/** Live monitor: every unacknowledged SOS with its waiting time, plus escalation levels reached. */
export const monitor = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const pending = await Emergency.find({ kind: 'sos', status: 'pending' }).sort({ createdAt: 1 }).limit(100);
  const escalations = await Escalation.find({ emergency: { $in: pending.map((p) => p._id) } });
  const now = Date.now();
  return ok(res, {
    deadlineSeconds: settings.ackDeadlineSeconds,
    maxLevel: settings.maxEscalationLevel,
    pendingSos: pending.map((p) => {
      const waited = Math.floor((now - p.createdAt.getTime()) / 1000);
      const levels = escalations.filter((e) => String(e.emergency) === String(p._id));
      return {
        id: String(p._id),
        emergencyId: p.emergencyId,
        type: p.type,
        affectedCount: p.affectedCount,
        description: p.description,
        createdAt: p.createdAt,
        waitedSeconds: waited,
        overdue: waited >= settings.ackDeadlineSeconds,
        escalationLevel: levels.reduce((m, e) => Math.max(m, e.level), 0),
        escalationIds: levels.map((e) => String(e._id)),
      };
    }),
  });
});

export const acknowledgeEscalation = asyncHandler(async (req, res) => {
  const e = await Escalation.findById(req.params.id);
  if (!e) throw notFound('ESCALATION_NOT_FOUND');
  if (e.status !== 'open') throw conflict('ESCALATION_NOT_OPEN', 'Only open escalations can be acknowledged');
  e.status = 'acknowledged';
  e.acknowledgedBy = req.user!._id;
  e.acknowledgedAt = new Date();
  if (req.body.note) e.note = req.body.note;
  await e.save();
  await audit(req.user, 'escalation.acknowledge', 'Escalation', e._id, { note: req.body.note }, req);
  emitToRoles(['admin'], 'escalation:updated', { id: String(e._id), status: e.status, emergency: String(e.emergency) });
  return ok(res, serialize(e, await Emergency.findById(e.emergency)));
});

export const resolveEscalation = asyncHandler(async (req, res) => {
  const e = await Escalation.findById(req.params.id);
  if (!e) throw notFound('ESCALATION_NOT_FOUND');
  if (e.status === 'resolved') throw conflict('ESCALATION_ALREADY_RESOLVED');
  e.status = 'resolved';
  e.resolvedAt = new Date();
  e.resolution = 'admin_resolved';
  if (req.body.note) e.note = req.body.note;
  if (!e.acknowledgedAt) {
    e.acknowledgedAt = new Date();
    e.acknowledgedBy = req.user!._id;
  }
  await e.save();
  await audit(req.user, 'escalation.resolve', 'Escalation', e._id, { note: req.body.note }, req);
  emitToRoles(['admin'], 'escalation:updated', { id: String(e._id), status: e.status, emergency: String(e.emergency) });
  return ok(res, serialize(e, await Emergency.findById(e.emergency)));
});

/** Manually trigger one monitoring pass (also what the scheduler runs). Useful for demos and diagnostics. */
export const runNow = asyncHandler(async (_req, res) => ok(res, await runEscalationCheck()));
