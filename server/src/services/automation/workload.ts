import { Assignment, Emergency, TeamMembership, RescueTeam, User } from '../../models';
import type { AutomationConfig } from '../settings.service';
import { haversineMeters, latLngOf, type LatLng } from '../../utils/geo';

export type LoadState = 'overloaded' | 'busy' | 'available' | 'unavailable';

export interface VolunteerLoad {
  id: string;
  name: string;
  role: string;
  skills: string[];
  availability: string;
  teamId: string | null;
  teamName: string | null;
  activeTasks: number;
  tasks: { assignmentId: string; emergencyId: string; emergencyRef: string; type: string; status: string; priority: string | null; viaTeam: boolean }[];
  state: LoadState;
  location: LatLng | null;
  locationSource: 'profile' | 'team' | null;
}

/** Pure rule: how loaded is a volunteer? (unit-tested) */
export function loadState(activeTasks: number, availability: string, overloadedAt: number): LoadState {
  if (availability === 'unavailable') return 'unavailable';
  if (activeTasks >= overloadedAt) return 'overloaded';
  if (activeTasks > 0) return 'busy';
  return 'available';
}

/**
 * Real workload from MongoDB: active assignments (direct or through team membership) whose emergency is not resolved.
 * Nothing here changes any assignment - it is monitoring only.
 */
export async function computeVolunteerLoads(cfg: AutomationConfig): Promise<VolunteerLoad[]> {
  const [users, memberships, teams, assignments] = await Promise.all([
    User.find({ role: { $in: ['volunteer', 'team_leader'] }, status: 'active' }).sort({ name: 1 }),
    TeamMembership.find({ active: true }).select('team user'),
    RescueTeam.find({ active: true }),
    Assignment.find({ status: 'active' }),
  ]);
  const ems = await Emergency.find({ _id: { $in: assignments.map((a) => a.emergency) }, status: { $ne: 'resolved' } }).select('emergencyId type status recommendedPriority finalPriority');
  const emById = new Map(ems.map((e) => [String(e._id), e]));
  const teamById = new Map(teams.map((t) => [String(t._id), t]));
  const teamOfUser = new Map<string, string>();
  memberships.forEach((m) => teamOfUser.set(String(m.user), String(m.team)));

  return users.map((u) => {
    const uid = String(u._id);
    const teamId = teamOfUser.get(uid) ?? null;
    const team = teamId ? teamById.get(teamId) : undefined;
    const tasks: VolunteerLoad['tasks'] = [];
    for (const a of assignments) {
      const em = emById.get(String(a.emergency));
      if (!em) continue;
      const direct = a.volunteers.some((v) => String(v) === uid);
      const viaTeam = !!a.team && !!teamId && String(a.team) === teamId;
      if (!direct && !viaTeam) continue;
      tasks.push({
        assignmentId: String(a._id),
        emergencyId: String(em._id),
        emergencyRef: em.emergencyId,
        type: em.type,
        status: em.status,
        priority: em.finalPriority?.level ?? em.recommendedPriority?.level ?? null,
        viaTeam: viaTeam && !direct,
      });
    }
    const own = latLngOf(u.homeLocation);
    const teamLoc = latLngOf(team?.lastLocation);
    return {
      id: uid,
      name: u.name,
      role: u.role,
      skills: u.skills,
      availability: u.availability,
      teamId,
      teamName: team?.name ?? null,
      activeTasks: tasks.length,
      tasks,
      state: loadState(tasks.length, u.availability, cfg.workload.overloadedAt),
      location: own ?? teamLoc,
      locationSource: own ? 'profile' : teamLoc ? 'team' : null,
    };
  });
}

export interface Alternative {
  id: string;
  name: string;
  skills: string[];
  activeTasks: number;
  state: LoadState;
  sharedSkills: string[];
  distanceKm: number | null;
}

/** Recommend less-loaded volunteers who could take over work. ADVISORY ONLY - no reassignment happens. */
export function alternativesFor(target: VolunteerLoad, all: VolunteerLoad[], limit = 3): Alternative[] {
  const mine = new Set(target.skills.map((s) => s.toLowerCase()));
  return all
    .filter((v) => v.id !== target.id && (v.state === 'available' || v.state === 'busy'))
    .map((v) => {
      const shared = v.skills.filter((s) => mine.has(s.toLowerCase()));
      const distanceKm = target.location && v.location ? Math.round((haversineMeters(target.location, v.location) / 1000) * 10) / 10 : null;
      return { id: v.id, name: v.name, skills: v.skills, activeTasks: v.activeTasks, state: v.state, sharedSkills: shared, distanceKm };
    })
    .sort((a, b) => b.sharedSkills.length - a.sharedSkills.length || a.activeTasks - b.activeTasks || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    .slice(0, limit);
}

export async function workloadReport(cfg: AutomationConfig) {
  const loads = await computeVolunteerLoads(cfg);
  const rows = loads.map((v) => ({ ...v, alternatives: v.state === 'overloaded' ? alternativesFor(v, loads) : [] }));
  const summary = {
    total: rows.length,
    overloaded: rows.filter((r) => r.state === 'overloaded').length,
    busy: rows.filter((r) => r.state === 'busy').length,
    available: rows.filter((r) => r.state === 'available').length,
    unavailable: rows.filter((r) => r.state === 'unavailable').length,
    overloadedAt: cfg.workload.overloadedAt,
  };
  return { summary, volunteers: rows };
}
