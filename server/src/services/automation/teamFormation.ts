import { Assignment, Emergency, RescueTeam, TeamMembership } from '../../models';
import type { EmergencyDoc } from '../../models/Emergency';
import { computeStaffing } from '../emergency.service';
import { PRIORITY_RANK } from '../priority.service';
import type { AutomationConfig } from '../settings.service';
import { haversineMeters, latLngOf, type LatLng } from '../../utils/geo';
import { computeVolunteerLoads, type VolunteerLoad } from './workload';

export interface Reason {
  code: string;
  params?: Record<string, unknown>;
}

export interface VolunteerScore {
  score: number;
  reasons: Reason[];
  distanceKm: number | null;
}

/**
 * Transparent scoring (max 100): skills 40 + availability 20 + workload 20 + distance 20.
 * Pure function (unit-tested). It RECOMMENDS only - an admin approves the final formation.
 */
export function scoreVolunteer(
  v: Pick<VolunteerLoad, 'skills' | 'availability' | 'activeTasks'>,
  requiredSkills: string[],
  distanceKm: number | null,
  cfg: Pick<AutomationConfig, 'workload' | 'teamFormation'>,
): VolunteerScore {
  const reasons: Reason[] = [];
  let score = 0;

  const req = [...new Set(requiredSkills.map((s) => s.toLowerCase()))];
  const have = new Set(v.skills.map((s) => s.toLowerCase()));
  if (req.length > 0) {
    const matched = req.filter((s) => have.has(s));
    score += Math.round((matched.length / req.length) * 40);
    reasons.push(matched.length > 0 ? { code: 'skills_match', params: { matched, required: req.length } } : { code: 'no_skill_match' });
  } else {
    score += 20;
    reasons.push({ code: 'no_skill_required' });
  }

  if (v.availability === 'available') {
    score += 20;
    reasons.push({ code: 'available' });
  } else {
    score += 8;
    reasons.push({ code: 'busy' });
  }

  const loadPts = Math.round(20 * (1 - Math.min(1, v.activeTasks / Math.max(1, cfg.workload.overloadedAt))));
  score += loadPts;
  reasons.push(v.activeTasks === 0 ? { code: 'no_current_workload' } : { code: 'current_workload', params: { count: v.activeTasks } });

  if (distanceKm === null) {
    score += 5;
    reasons.push({ code: 'location_unknown' });
  } else if (distanceKm > cfg.teamFormation.maxDistanceKm) {
    reasons.push({ code: 'far_away', params: { km: distanceKm } });
  } else {
    score += Math.round(20 * (1 - distanceKm / cfg.teamFormation.maxDistanceKm));
    reasons.push({ code: 'distance', params: { km: distanceKm } });
  }
  return { score, reasons, distanceKm };
}

/** Greedy selection: first cover every required skill with the best-scoring person, then fill by score. (unit-tested) */
export function pickFormation<T extends { id: string; skills: string[]; score: number }>(ranked: T[], size: number, requiredSkills: string[]) {
  const chosen: T[] = [];
  const covered = new Set<string>();
  const req = [...new Set(requiredSkills.map((s) => s.toLowerCase()))];
  for (const skill of req) {
    if (chosen.length >= size) break;
    if (covered.has(skill)) continue;
    const p = ranked.find((r) => !chosen.includes(r) && r.skills.some((s) => s.toLowerCase() === skill));
    if (p) {
      chosen.push(p);
      p.skills.forEach((s) => covered.add(s.toLowerCase()));
    }
  }
  for (const r of ranked) {
    if (chosen.length >= size) break;
    if (!chosen.includes(r)) {
      chosen.push(r);
      r.skills.forEach((s) => covered.add(s.toLowerCase()));
    }
  }
  return { chosen, coveredSkills: req.filter((s) => covered.has(s)), missingSkills: req.filter((s) => !covered.has(s)) };
}

const km = (a: LatLng | null, b: LatLng | null) => (a && b ? Math.round((haversineMeters(a, b) / 1000) * 10) / 10 : null);

/** Recommendation for ONE emergency (volunteers, proposed formation, existing teams). Nothing is dispatched. */
export async function recommendForEmergency(em: EmergencyDoc, cfg: AutomationConfig, preloaded?: VolunteerLoad[]) {
  const loads = preloaded ?? (await computeVolunteerLoads(cfg));
  const staffing = (await computeStaffing([em])).get(String(em._id))!;
  const alreadyOn = new Set<string>();
  const active = await Assignment.find({ emergency: em._id, status: 'active' });
  const activeTeamIds = active.filter((a) => a.team).map((a) => a.team);
  (await TeamMembership.find({ team: { $in: activeTeamIds }, active: true }).select('user')).forEach((m) => alreadyOn.add(String(m.user)));
  active.forEach((a) => a.volunteers.forEach((v) => alreadyOn.add(String(v))));

  const target = latLngOf(em.location);
  let excludedOverloaded = 0;
  let excludedUnavailable = 0;
  const ranked = loads
    .filter((v) => {
      if (alreadyOn.has(v.id)) return false;
      if (v.state === 'unavailable') {
        excludedUnavailable += 1;
        return false;
      }
      if (v.state === 'overloaded') {
        excludedOverloaded += 1;
        return false;
      }
      return true;
    })
    .map((v) => {
      const s = scoreVolunteer(v, em.requiredSkills, km(target, v.location), cfg);
      return { id: v.id, name: v.name, role: v.role, skills: v.skills, availability: v.availability, activeTasks: v.activeTasks, teamId: v.teamId, teamName: v.teamName, locationSource: v.locationSource, ...s };
    })
    .sort((a, b) => b.score - a.score);

  const needed = staffing.gap > 0 ? staffing.gap : em.requiredVolunteers === 0 && active.length === 0 ? 3 : 0;
  const { chosen, coveredSkills, missingSkills } = pickFormation(ranked, needed, em.requiredSkills);

  const teams = await RescueTeam.find({ active: true, availability: { $ne: 'offline' } });
  const members = await TeamMembership.find({ active: true }).select('team user');
  const teamRows = teams
    .map((t) => {
      const size = members.filter((m) => String(m.team) === String(t._id)).length;
      const memberLoads = loads.filter((l) => l.teamId === String(t._id));
      const workload = memberLoads.length ? Math.max(...memberLoads.map((l) => l.activeTasks)) : 0;
      const skills = new Set([...t.skills, ...memberLoads.flatMap((l) => l.skills)].map((s) => s.toLowerCase()));
      const req = em.requiredSkills.map((s) => s.toLowerCase());
      const matched = req.filter((s) => skills.has(s));
      const d = km(target, latLngOf(t.lastLocation));
      const reasons: Reason[] = [];
      let score = req.length ? Math.round((matched.length / req.length) * 40) : 20;
      reasons.push(req.length ? (matched.length ? { code: 'skills_match', params: { matched, required: req.length } } : { code: 'no_skill_match' }) : { code: 'no_skill_required' });
      score += t.availability === 'available' ? 20 : 8;
      reasons.push({ code: t.availability === 'available' ? 'available' : 'busy' });
      const loadPts = Math.round(20 * (1 - Math.min(1, workload / Math.max(1, cfg.workload.overloadedAt))));
      score += loadPts;
      reasons.push(workload === 0 ? { code: 'no_current_workload' } : { code: 'current_workload', params: { count: workload } });
      if (d === null) {
        score += 5;
        reasons.push({ code: 'location_unknown' });
      } else if (d > cfg.teamFormation.maxDistanceKm) reasons.push({ code: 'far_away', params: { km: d } });
      else {
        score += Math.round(20 * (1 - d / cfg.teamFormation.maxDistanceKm));
        reasons.push({ code: 'distance', params: { km: d } });
      }
      const alreadyAssigned = active.some((a) => a.team && String(a.team) === String(t._id));
      return { id: String(t._id), name: t.name, size, capacity: t.capacity, openSlots: Math.max(0, t.capacity - size), skills: t.skills, workload, distanceKm: d, score, reasons, alreadyAssigned };
    })
    .filter((t) => !t.alreadyAssigned && t.size > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    emergency: { id: String(em._id), emergencyId: em.emergencyId, type: em.type, status: em.status, affectedCount: em.affectedCount, requiredVolunteers: em.requiredVolunteers, requiredSkills: em.requiredSkills, priority: em.finalPriority?.level ?? em.recommendedPriority?.level, priorityConfirmed: Boolean(em.finalPriority?.level) },
    staffing,
    volunteers: ranked.slice(0, 10),
    proposedFormation: { size: needed, volunteerIds: chosen.map((c) => c.id), members: chosen.map((c) => ({ id: c.id, name: c.name, score: c.score })), coveredSkills, missingSkills },
    teams: teamRows,
    excluded: { overloaded: excludedOverloaded, unavailable: excludedUnavailable },
    canApprove: em.status === 'acknowledged' || em.status === 'assigned' || em.status === 'in_progress',
    notice: 'recommendation_only',
  };
}

/** Emergencies that currently need people, with the best candidates - the dashboard card "Recommended rescue teams". */
export async function recommendationsOverview(cfg: AutomationConfig, limit = 8) {
  const candidates = await Emergency.find({ status: { $in: ['pending', 'acknowledged', 'assigned', 'in_progress'] } }).sort({ priorityRank: -1, createdAt: 1 }).limit(60);
  const staffing = await computeStaffing(candidates);
  const needing = candidates.filter((e) => {
    const s = staffing.get(String(e._id))!;
    return s.gap > 0 || (s.assigned === 0 && ['pending', 'acknowledged'].includes(e.status));
  });
  needing.sort((a, b) => PRIORITY_RANK[(b.finalPriority?.level ?? b.recommendedPriority.level) as keyof typeof PRIORITY_RANK] - PRIORITY_RANK[(a.finalPriority?.level ?? a.recommendedPriority.level) as keyof typeof PRIORITY_RANK]);
  const loads = await computeVolunteerLoads(cfg);
  const rows = [];
  for (const e of needing.slice(0, limit)) {
    const rec = await recommendForEmergency(e, cfg, loads);
    rows.push({ emergency: rec.emergency, staffing: rec.staffing, topVolunteers: rec.volunteers.slice(0, 3), proposedFormation: rec.proposedFormation, topTeam: rec.teams[0] ?? null });
  }
  return { total: needing.length, items: rows };
}

/** Teams that need additional members: an active assignment is understaffed or required skills are not covered. */
export async function teamsNeedingMembers(cfg: AutomationConfig) {
  const loads = await computeVolunteerLoads(cfg);
  const teams = await RescueTeam.find({ active: true });
  const assignments = await Assignment.find({ status: 'active', team: { $in: teams.map((t) => t._id) } });
  const ems = await Emergency.find({ _id: { $in: assignments.map((a) => a.emergency) }, status: { $ne: 'resolved' } });
  const staffing = await computeStaffing(ems);
  const unteamed = loads.filter((l) => !l.teamId && l.state !== 'unavailable' && l.state !== 'overloaded');
  const out = [];
  for (const t of teams) {
    const mine = assignments.filter((a) => String(a.team) === String(t._id));
    const myEms = mine.map((a) => ems.find((e) => String(e._id) === String(a.emergency))).filter((e): e is EmergencyDoc => Boolean(e));
    if (myEms.length === 0) continue;
    const memberLoads = loads.filter((l) => l.teamId === String(t._id));
    const teamSkills = new Set([...t.skills, ...memberLoads.flatMap((l) => l.skills)].map((s) => s.toLowerCase()));
    const missingSkills = [...new Set(myEms.flatMap((e) => e.requiredSkills.map((s) => s.toLowerCase())))].filter((s) => !teamSkills.has(s));
    const gap = Math.max(...myEms.map((e) => staffing.get(String(e._id))?.gap ?? 0));
    const openSlots = Math.max(0, t.capacity - memberLoads.length);
    if (gap === 0 && missingSkills.length === 0) continue;
    const suggestions = unteamed
      .map((l) => ({ l, s: scoreVolunteer(l, missingSkills.length ? missingSkills : myEms.flatMap((e) => e.requiredSkills), km(latLngOf(t.lastLocation) ?? latLngOf(myEms[0].location), l.location), cfg) }))
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 3)
      .map(({ l, s }) => ({ id: l.id, name: l.name, skills: l.skills, score: s.score, reasons: s.reasons, distanceKm: s.distanceKm }));
    out.push({
      team: { id: String(t._id), name: t.name, size: memberLoads.length, capacity: t.capacity, openSlots },
      shortfall: gap,
      missingSkills,
      emergencies: myEms.map((e) => ({ id: String(e._id), emergencyId: e.emergencyId, type: e.type, required: e.requiredVolunteers })),
      suggestions,
    });
  }
  return out;
}
