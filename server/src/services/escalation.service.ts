import type { Types } from 'mongoose';
import { Emergency, Escalation, User } from '../models';
import { getSettings } from './settings.service';
import { notifyUsers } from './notification.service';
import { emitToRoles } from '../sockets';

export interface EscalationCandidate {
  id: string;
  createdAt: Date;
}

export interface EscalationDecision {
  emergencyId: string;
  level: number;
  waitedSeconds: number;
}

/**
 * Pure decision logic (unit-tested). Level N is due once the SOS has waited N-th "step" of the deadline:
 * level 1 at 1x the deadline, level 2 at 2x, level 3 at 4x, ... capped by `maxLevel`.
 * `existingLevels` are the levels already recorded for each emergency; each level fires at most once.
 */
export function levelThresholdSeconds(level: number, deadlineSeconds: number): number {
  return deadlineSeconds * 2 ** (level - 1);
}

export function evaluateEscalations(
  candidates: EscalationCandidate[],
  existingLevels: Map<string, Set<number>>,
  now: Date,
  deadlineSeconds: number,
  maxLevel: number,
): EscalationDecision[] {
  const out: EscalationDecision[] = [];
  for (const c of candidates) {
    const waited = (now.getTime() - c.createdAt.getTime()) / 1000;
    const seen = existingLevels.get(c.id) ?? new Set<number>();
    // Highest level that is currently due.
    let due = 0;
    for (let level = 1; level <= maxLevel; level += 1) {
      if (waited >= levelThresholdSeconds(level, deadlineSeconds)) due = level;
    }
    // Create every due level that was never recorded (e.g. after server downtime) - exactly once each.
    for (let level = 1; level <= due; level += 1) {
      if (!seen.has(level)) out.push({ emergencyId: c.id, level, waitedSeconds: Math.floor(waited) });
    }
  }
  return out;
}

let running = false;

/** One monitoring pass. Safe to call concurrently (guarded) and idempotent thanks to the unique index. */
export async function runEscalationCheck(now: Date = new Date()): Promise<{ created: number }> {
  if (running) return { created: 0 };
  running = true;
  try {
    const settings = await getSettings();
    const cutoff = new Date(now.getTime() - settings.ackDeadlineSeconds * 1000);
    const overdue = await Emergency.find({
      kind: 'sos',
      status: 'pending',
      acknowledgedAt: { $exists: false },
      createdAt: { $lte: cutoff },
    })
      .select('_id createdAt emergencyId')
      .limit(500);

    if (overdue.length === 0) return { created: 0 };

    const records = await Escalation.find({ emergency: { $in: overdue.map((e) => e._id) } }).select('emergency level');
    const existing = new Map<string, Set<number>>();
    for (const r of records) {
      const key = String(r.emergency);
      if (!existing.has(key)) existing.set(key, new Set());
      existing.get(key)!.add(r.level);
    }

    const decisions = evaluateEscalations(
      overdue.map((e) => ({ id: String(e._id), createdAt: e.createdAt })),
      existing,
      now,
      settings.ackDeadlineSeconds,
      settings.maxEscalationLevel,
    );

    let created = 0;
    const admins = await User.find({ role: 'admin', status: 'active' }).select('_id');
    for (const d of decisions) {
      try {
        const esc = await Escalation.create({
          emergency: d.emergencyId as unknown as Types.ObjectId,
          level: d.level,
          waitedSecondsAtTrigger: d.waitedSeconds,
          deadlineSeconds: settings.ackDeadlineSeconds,
          triggeredAt: now,
        });
        created += 1;
        const em = overdue.find((e) => String(e._id) === d.emergencyId);
        const params = { emergencyId: em?.emergencyId, level: d.level, minutes: Math.floor(d.waitedSeconds / 60) };
        await notifyUsers(
          admins.map((a) => a._id),
          {
            type: 'sos_escalated',
            params,
            message: `SOS ${params.emergencyId} is unacknowledged after ${params.minutes} min (escalation level ${d.level})`,
            link: '/admin/escalations',
            entityType: 'escalation',
            entityId: String(esc._id),
          },
        );
        emitToRoles(['admin'], 'escalation:triggered', {
          id: String(esc._id),
          emergency: d.emergencyId,
          emergencyId: em?.emergencyId,
          level: d.level,
          waitedSeconds: d.waitedSeconds,
        });
      } catch (err) {
        // Duplicate key = another instance/run already recorded this level: exactly what the index is for.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    return { created };
  } finally {
    running = false;
  }
}

/** Auto-resolve open escalations once the SOS has been acknowledged. */
export async function resolveEscalationsFor(emergencyId: Types.ObjectId): Promise<void> {
  const open = await Escalation.find({ emergency: emergencyId, status: { $in: ['open', 'acknowledged'] } });
  for (const e of open) {
    e.status = 'resolved';
    e.resolvedAt = new Date();
    e.resolution = 'emergency_acknowledged';
    await e.save();
    emitToRoles(['admin'], 'escalation:updated', { id: String(e._id), status: e.status, emergency: String(emergencyId) });
  }
}
