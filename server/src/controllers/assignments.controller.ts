import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import type { UserDoc } from '../models/User';
import { Assignment, Emergency, RescueTeam, TeamMembership, User } from '../models';
import type { AssignmentDoc, IAssignment } from '../models/Assignment';
import { audit } from '../services/audit.service';
import { assignedUserIds } from '../services/assignment.service';
import { computeStaffing, emitEmergencyEvent, getUserTeamIds, transitionEmergency } from '../services/emergency.service';
import { notifyRoles, notifyUsers } from '../services/notification.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { asyncHandler, created, ok } from '../utils/http';
import { emitToTeams, emitToUser, joinTeamRoom } from '../sockets';

const ASSIGNABLE_STATUSES = ['acknowledged', 'assigned', 'in_progress'];

export function serializeAssignment(a: AssignmentDoc) {
  const team = a.team as unknown as { _id?: unknown; name?: string } | undefined;
  const em = a.emergency as unknown as { _id?: unknown; emergencyId?: string; type?: string; status?: string; kind?: string } | undefined;
  return {
    id: String(a._id),
    status: a.status,
    team: team && typeof team === 'object' && 'name' in team ? { id: String(team._id), name: team.name } : a.team ? { id: String(a.team) } : null,
    volunteers: (a.volunteers as unknown as { _id?: unknown; name?: string }[]).map((v) => (typeof v === 'object' && 'name' in v ? { id: String(v._id), name: v.name } : { id: String(v) })),
    emergency: em && typeof em === 'object' && 'emergencyId' in em ? { id: String(em._id), emergencyId: em.emergencyId, type: em.type, status: em.status, kind: em.kind } : { id: String(a.emergency) },
    instructions: a.instructions,
    assignedAt: a.assignedAt,
    endedAt: a.endedAt,
    reassignReason: a.reassignReason,
    progress: a.progress.map((p) => ({ note: p.note, percent: p.percent, at: p.at })),
  };
}

async function validateTarget(teamId: string | undefined, volunteerIds: string[]) {
  if (teamId) {
    const team = await RescueTeam.findById(teamId);
    if (!team || !team.active) throw notFound('TEAM_NOT_FOUND', 'Team not found or inactive');
    if (team.availability === 'offline') throw conflict('TEAM_OFFLINE', 'This team is marked offline');
    if ((await TeamMembership.countDocuments({ team: team._id, active: true })) === 0) throw badRequest('TEAM_EMPTY', 'This team has no members');
  }
  if (volunteerIds.length) {
    const users = await User.find({ _id: { $in: volunteerIds }, status: 'active', role: { $in: ['volunteer', 'team_leader'] } });
    if (users.length !== new Set(volunteerIds).size) throw badRequest('VOLUNTEER_NOT_FOUND', 'One or more volunteers are invalid or inactive');
  }
}

async function targetUsers(a: Pick<IAssignment, 'team' | 'volunteers'>): Promise<string[]> {
  const ids = new Set<string>(a.volunteers.map(String));
  if (a.team) (await TeamMembership.find({ team: a.team, active: true }).select('user')).forEach((m) => ids.add(String(m.user)));
  return [...ids];
}

export interface AssignmentInput {
  emergencyId: string;
  teamId?: string;
  volunteerIds: string[];
  instructions?: string;
}

/** Validated creation of an assignment (admin action). Used by the assignment endpoint and by team-formation approval. */
export async function performAssignment(user: UserDoc, input: AssignmentInput, req?: Request) {
  const { emergencyId, teamId, volunteerIds, instructions } = input;
  const em = await Emergency.findById(emergencyId);
  if (!em) throw notFound('EMERGENCY_NOT_FOUND');
  if (em.status === 'pending') throw conflict('EMERGENCY_NOT_ACKNOWLEDGED', 'Acknowledge the emergency before assigning a team');
  if (!ASSIGNABLE_STATUSES.includes(em.status)) throw conflict('EMERGENCY_NOT_ASSIGNABLE', `An emergency in status "${em.status}" cannot receive new assignments`);
  // Nothing is dispatched until an administrator has confirmed (or overridden) the recommended priority.
  if (!em.finalPriority?.level) throw conflict('PRIORITY_NOT_CONFIRMED', 'Confirm or override the recommended priority before assigning responders');
  await validateTarget(teamId, volunteerIds);

  if (teamId && (await Assignment.exists({ emergency: em._id, team: teamId, status: 'active' }))) throw conflict('TEAM_ALREADY_ASSIGNED', 'This team is already assigned to the emergency');

  const otherLoad = teamId ? await Assignment.countDocuments({ team: teamId, status: 'active' }) : 0;
  const assignment = await Assignment.create({ emergency: em._id, team: teamId, volunteers: volunteerIds, instructions, assignedBy: user._id });
  if (em.status === 'acknowledged') await transitionEmergency(em, 'assigned', user, 'team_assigned');

  const recipients = await targetUsers(assignment);
  if (teamId) recipients.forEach((r) => joinTeamRoom(r, teamId));
  await notifyUsers(recipients, {
    type: 'assignment_created',
    params: { emergencyId: em.emergencyId, priority: em.finalPriority.level },
    message: `You were assigned to ${em.emergencyId} (${em.finalPriority.level} priority)`,
    link: `/responder/emergencies/${em._id}`,
    entityType: 'emergency',
    entityId: String(em._id),
  });
  await audit(user, 'assignment.create', 'Assignment', assignment._id, { emergency: em.emergencyId, teamId, volunteerIds }, req);
  await emitEmergencyEvent(em, 'assignment:changed', { assignmentId: String(assignment._id) });
  const staffing = (await computeStaffing([em])).get(String(em._id));
  const populated = await Assignment.findById(assignment._id).populate('team', 'name').populate('volunteers', 'name').populate('emergency', 'emergencyId type status kind');
  return { assignment: serializeAssignment(populated!), staffing, otherLoad };
}

export const createAssignment = asyncHandler(async (req, res) => {
  const r = await performAssignment(req.user!, req.body as AssignmentInput, req);
  return created(res, r.assignment, { staffing: r.staffing, teamWorkloadBefore: r.otherLoad });
});

export const reassign = asyncHandler(async (req, res) => {
  const user = req.user!;
  const old = await Assignment.findById(req.params.id);
  if (!old) throw notFound('ASSIGNMENT_NOT_FOUND');
  if (old.status !== 'active') throw conflict('ASSIGNMENT_NOT_ACTIVE', 'Only active assignments can be reassigned');
  const em = await Emergency.findById(old.emergency);
  if (!em || !['assigned', 'in_progress'].includes(em.status)) throw conflict('EMERGENCY_NOT_REASSIGNABLE', 'The emergency is not in a state that allows reassignment');
  const { teamId, volunteerIds, reason, instructions } = req.body as { teamId?: string; volunteerIds: string[]; reason: string; instructions?: string };
  if (!teamId && volunteerIds.length === 0) throw badRequest('TEAM_OR_VOLUNTEERS_REQUIRED');
  const sameTeam = (teamId ?? '') === String(old.team ?? '');
  const sameVols = JSON.stringify([...volunteerIds].sort()) === JSON.stringify(old.volunteers.map(String).sort());
  if (sameTeam && sameVols) throw badRequest('NO_CHANGES', 'The new allocation is identical to the current one');
  await validateTarget(teamId, volunteerIds);
  if (teamId && (await Assignment.exists({ emergency: em._id, team: teamId, status: 'active', _id: { $ne: old._id } }))) throw conflict('TEAM_ALREADY_ASSIGNED');

  const previousRecipients = await targetUsers(old);
  old.status = 'reassigned';
  old.endedAt = new Date();
  old.reassignReason = reason;
  await old.save();
  const next = await Assignment.create({
    emergency: em._id,
    team: teamId,
    volunteers: volunteerIds,
    instructions: instructions ?? old.instructions,
    assignedBy: user._id,
    reassignedFrom: old._id,
    reassignReason: reason,
  });
  const newRecipients = await targetUsers(next);
  const removed = previousRecipients.filter((r) => !newRecipients.includes(r));
  await notifyUsers(removed, { type: 'assignment_removed', params: { emergencyId: em.emergencyId }, message: `You were reassigned away from ${em.emergencyId}`, entityType: 'emergency', entityId: String(em._id) });
  await notifyUsers(newRecipients, { type: 'assignment_created', params: { emergencyId: em.emergencyId, priority: em.finalPriority?.level }, message: `You were assigned to ${em.emergencyId}`, link: `/responder/emergencies/${em._id}`, entityType: 'emergency', entityId: String(em._id) });
  if (old.team) emitToTeams([String(old.team)], 'assignment:changed', { emergencyId: em.emergencyId, id: String(em._id) });
  removed.forEach((r) => emitToUser(r, 'assignment:changed', { emergencyId: em.emergencyId, id: String(em._id) }));
  await audit(user, 'assignment.reassign', 'Assignment', next._id, { emergency: em.emergencyId, from: String(old._id), reason, teamId, volunteerIds }, req);
  await emitEmergencyEvent(em, 'assignment:changed', { assignmentId: String(next._id) });
  const populated = await Assignment.findById(next._id).populate('team', 'name').populate('volunteers', 'name').populate('emergency', 'emergencyId type status kind');
  return ok(res, serializeAssignment(populated!), { staffing: (await computeStaffing([em])).get(String(em._id)) });
});

export const listAssignments = asyncHandler(async (req, res) => {
  const user = req.user!;
  const filter: FilterQuery<IAssignment> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.emergencyId) filter.emergency = String(req.query.emergencyId);
  if (user.role !== 'admin') {
    const teamIds = await getUserTeamIds(user._id);
    filter.$or = [{ team: { $in: teamIds } }, { volunteers: user._id }];
    filter.status = 'active';
  }
  const items = await Assignment.find(filter).sort({ createdAt: -1 }).limit(200).populate('team', 'name').populate('volunteers', 'name').populate('emergency', 'emergencyId type status kind');
  return ok(res, items.map(serializeAssignment));
});

export const addProgress = asyncHandler(async (req, res) => {
  const user = req.user!;
  const a = await Assignment.findById(req.params.id);
  if (!a) throw notFound('ASSIGNMENT_NOT_FOUND');
  if (a.status !== 'active') throw conflict('ASSIGNMENT_NOT_ACTIVE', 'This assignment is no longer active');
  const teamIds = (await getUserTeamIds(user._id)).map(String);
  const member = (a.team && teamIds.includes(String(a.team))) || a.volunteers.some((v) => String(v) === String(user._id));
  if (!member) throw forbidden('FORBIDDEN_RESOURCE', 'You are not part of this assignment');
  const { note, percent } = req.body as { note: string; percent?: number };
  if (percent !== undefined && user.role !== 'team_leader') throw forbidden('FORBIDDEN_PERCENT', 'Only the team leader can set the overall progress percentage');
  a.progress.push({ by: user._id, note, percent, at: new Date() });
  await a.save();
  const em = await Emergency.findById(a.emergency);
  if (em) {
    await notifyRoles(['admin'], { type: 'progress_update', params: { emergencyId: em.emergencyId, percent }, message: `Progress update on ${em.emergencyId}`, link: `/admin/emergencies/${em._id}`, entityType: 'emergency', entityId: String(em._id) });
    await emitEmergencyEvent(em, 'assignment:changed', { assignmentId: String(a._id) });
  }
  const populated = await Assignment.findById(a._id).populate('team', 'name').populate('volunteers', 'name').populate('emergency', 'emergencyId type status kind');
  return ok(res, serializeAssignment(populated!));
});

export { assignedUserIds };
