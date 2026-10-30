import type { Types } from 'mongoose';
import { Assignment, RescueTeam, TeamMembership, User } from '../models';
import type { EmergencyDoc } from '../models/Emergency';

/** Everyone currently responsible for an emergency: active team members plus directly assigned volunteers. */
export async function assignedUserIds(emergencyId: Types.ObjectId | string): Promise<string[]> {
  const assignments = await Assignment.find({ emergency: emergencyId, status: 'active' }).select('team volunteers');
  const teamIds = assignments.filter((a) => a.team).map((a) => a.team);
  const members = teamIds.length ? await TeamMembership.find({ team: { $in: teamIds }, active: true }).select('user') : [];
  const ids = new Set<string>();
  members.forEach((m) => ids.add(String(m.user)));
  assignments.forEach((a) => a.volunteers.forEach((v) => ids.add(String(v))));
  return [...ids];
}

export interface Suggestion<T> {
  item: T;
  score: number;
  reasons: { code: string; params?: Record<string, unknown> }[];
}

/** Pure scoring helper used for both volunteer and team suggestions (unit-tested). */
export function scoreCandidate(
  required: string[],
  skills: string[],
  availability: string,
  workload: number,
): { score: number; reasons: { code: string; params?: Record<string, unknown> }[] } {
  const reasons: { code: string; params?: Record<string, unknown> }[] = [];
  let score = 0;
  const req = required.map((s) => s.toLowerCase());
  const have = new Set(skills.map((s) => s.toLowerCase()));
  if (req.length > 0) {
    const matched = req.filter((s) => have.has(s));
    const pts = Math.round((matched.length / req.length) * 60);
    score += pts;
    if (matched.length > 0) reasons.push({ code: 'skills_match', params: { matched, required: req.length } });
    else reasons.push({ code: 'no_skill_match' });
  } else {
    score += 30; // no skill requirement: neutral
  }
  if (availability === 'available') {
    score += 20;
    reasons.push({ code: 'available' });
  } else if (availability === 'busy') {
    score += 5;
    reasons.push({ code: 'busy' });
  } else {
    reasons.push({ code: 'unavailable' });
  }
  const loadPts = Math.max(0, 20 - workload * 5);
  score += loadPts;
  reasons.push({ code: workload === 0 ? 'no_current_workload' : 'current_workload', params: { count: workload } });
  return { score, reasons };
}

/** SUGGESTIONS ONLY - nothing is assigned automatically. */
export async function suggestForEmergency(em: EmergencyDoc) {
  const activeAssignments = await Assignment.find({ status: 'active' }).select('team volunteers emergency');
  const memberships = await TeamMembership.find({ active: true }).select('team user');

  const volunteers = await User.find({ role: { $in: ['volunteer', 'team_leader'] }, status: 'active', availability: { $ne: 'unavailable' } });
  const volunteerSuggestions = volunteers
    .map((v) => {
      const teamIds = memberships.filter((m) => String(m.user) === String(v._id)).map((m) => String(m.team));
      const workload = activeAssignments.filter(
        (a) => String(a.emergency) !== String(em._id) && ((a.team && teamIds.includes(String(a.team))) || a.volunteers.some((x) => String(x) === String(v._id))),
      ).length;
      const inTeam = teamIds.length > 0;
      const { score, reasons } = scoreCandidate(em.requiredSkills, v.skills, v.availability, workload);
      return { id: String(v._id), name: v.name, skills: v.skills, availability: v.availability, workload, inTeam, score, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const teams = await RescueTeam.find({ active: true, availability: { $ne: 'offline' } });
  const teamSuggestions = teams
    .map((t) => {
      const size = memberships.filter((m) => String(m.team) === String(t._id)).length;
      const workload = activeAssignments.filter((a) => a.team && String(a.team) === String(t._id) && String(a.emergency) !== String(em._id)).length;
      const { score, reasons } = scoreCandidate(em.requiredSkills, t.skills, t.availability, workload);
      return { id: String(t._id), name: t.name, skills: t.skills, availability: t.availability, members: size, capacity: t.capacity, workload, score, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return { volunteers: volunteerSuggestions, teams: teamSuggestions };
}
