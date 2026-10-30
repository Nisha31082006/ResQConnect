import type { Types } from 'mongoose';
import { Assignment, RescueTeam, TeamMembership, User } from '../models';
import type { RescueTeamDoc } from '../models/RescueTeam';
import type { UserDoc } from '../models/User';
import { audit } from '../services/audit.service';
import { notifyUsers } from '../services/notification.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { latLngOf, pointFrom } from '../utils/geo';
import { idOf } from '../utils/ids';
import { asyncHandler, created, ok } from '../utils/http';
import { emitToRoles, joinTeamRoom, leaveTeamRoom } from '../sockets';

const RESPONDER_ROLES = ['volunteer', 'team_leader'];

async function activeMemberCount(teamId: Types.ObjectId | string): Promise<number> {
  return TeamMembership.countDocuments({ team: teamId, active: true });
}

async function assertAvailableUsers(ids: string[], opts: { leader?: boolean; ignoreTeam?: string }) {
  const users = await User.find({ _id: { $in: ids } });
  if (users.length !== new Set(ids).size) throw notFound('USER_NOT_FOUND', 'One or more users were not found');
  for (const u of users) {
    if (u.status !== 'active') throw badRequest('USER_NOT_ACTIVE', `${u.name} is not an active user`);
    if (opts.leader ? u.role !== 'team_leader' : !RESPONDER_ROLES.includes(u.role)) {
      throw badRequest(opts.leader ? 'LEADER_ROLE_REQUIRED' : 'VOLUNTEER_ROLE_REQUIRED', `${u.name} does not have the required role`);
    }
  }
  // A person can be an active member of only one team at a time (keeps workload and accountability clear).
  const taken = await TeamMembership.find({ user: { $in: ids }, active: true });
  const conflictRow = taken.find((m) => String(m.team) !== opts.ignoreTeam);
  if (conflictRow) {
    const u = users.find((x) => String(x._id) === String(conflictRow.user));
    throw conflict('USER_ALREADY_IN_TEAM', `${u?.name ?? 'User'} already belongs to another team`, { userId: String(conflictRow.user) });
  }
  return users;
}

export async function serializeTeam(team: RescueTeamDoc, includeLocation: boolean) {
  const memberships = await TeamMembership.find({ team: team._id, active: true }).populate('user', 'name skills availability phone');
  const workload = await Assignment.countDocuments({ team: team._id, status: 'active' });
  const ll = latLngOf(team.lastLocation);
  return {
    id: String(team._id),
    name: team.name,
    leader: (() => {
      const l = memberships.find((m) => m.role === 'leader');
      const u = l?.user as unknown as UserDoc | undefined;
      return u ? { id: String(u._id), name: u.name } : { id: idOf(team.leader), name: null };
    })(),
    skills: team.skills,
    capacity: team.capacity,
    availability: team.availability,
    notes: team.notes,
    active: team.active,
    memberCount: memberships.length,
    members: memberships.map((m) => {
      const u = m.user as unknown as UserDoc;
      return { id: String(u._id), name: u.name, skills: u.skills, availability: u.availability, role: m.role };
    }),
    workload,
    lastLocation: includeLocation && ll ? { ...ll, at: team.lastLocationAt } : null,
    createdAt: team.createdAt,
  };
}

export const createTeam = asyncHandler(async (req, res) => {
  const { name, leaderId, memberIds, skills, capacity, availability, notes } = req.body;
  const members = [...new Set<string>(memberIds)].filter((id) => id !== leaderId);
  if (members.length + 1 > capacity) throw badRequest('TEAM_CAPACITY_EXCEEDED', 'The team capacity is smaller than the number of members');
  if (await RescueTeam.exists({ name })) throw conflict('TEAM_NAME_TAKEN', 'A team with this name already exists');
  if (await RescueTeam.exists({ leader: leaderId, active: true })) throw conflict('LEADER_ALREADY_ASSIGNED', 'This leader already leads another team');

  await assertAvailableUsers([leaderId], { leader: true });
  if (members.length) await assertAvailableUsers(members, {});

  const team = await RescueTeam.create({ name, leader: leaderId, skills, capacity, availability, notes, createdBy: req.user!._id });
  const rows = [
    { team: team._id, user: leaderId, role: 'leader' as const, addedBy: req.user!._id },
    ...members.map((u) => ({ team: team._id, user: u, role: 'member' as const, addedBy: req.user!._id })),
  ];
  await TeamMembership.insertMany(rows);
  rows.forEach((r) => joinTeamRoom(String(r.user), String(team._id)));
  await audit(req.user, 'team.create', 'RescueTeam', team._id, { name, leaderId, members: members.length }, req);
  await notifyUsers(rows.map((r) => r.user), {
    type: 'team_membership_added',
    params: { team: team.name },
    message: `You were added to team ${team.name}`,
    link: '/responder/team',
    entityType: 'team',
    entityId: String(team._id),
  });
  return created(res, await serializeTeam(team, true));
});

export const listTeams = asyncHandler(async (req, res) => {
  const user = req.user!;
  let teams: RescueTeamDoc[];
  if (user.role === 'admin') teams = await RescueTeam.find({}).sort({ name: 1 });
  else {
    const mine = await TeamMembership.find({ user: user._id, active: true }).select('team');
    teams = await RescueTeam.find({ _id: { $in: mine.map((m) => m.team) } }).sort({ name: 1 });
  }
  const items = await Promise.all(teams.map((t) => serializeTeam(t, true)));
  return ok(res, items);
});

export const getTeam = asyncHandler(async (req, res) => {
  const user = req.user!;
  const team = await RescueTeam.findById(req.params.id);
  if (!team) throw notFound('TEAM_NOT_FOUND');
  if (user.role !== 'admin') {
    const m = await TeamMembership.exists({ team: team._id, user: user._id, active: true });
    if (!m) throw forbidden('FORBIDDEN_RESOURCE', 'You are not a member of this team');
  }
  return ok(res, await serializeTeam(team, true));
});

export const updateTeam = asyncHandler(async (req, res) => {
  const team = await RescueTeam.findById(req.params.id);
  if (!team) throw notFound('TEAM_NOT_FOUND');
  const { leaderId, ...rest } = req.body;
  if (rest.capacity !== undefined && rest.capacity < (await activeMemberCount(team._id))) throw badRequest('TEAM_CAPACITY_EXCEEDED', 'Capacity is smaller than the current number of members');
  if (rest.name && rest.name !== team.name && (await RescueTeam.exists({ name: rest.name }))) throw conflict('TEAM_NAME_TAKEN');

  if (leaderId && leaderId !== String(team.leader)) {
    if (await RescueTeam.exists({ leader: leaderId, active: true, _id: { $ne: team._id } })) throw conflict('LEADER_ALREADY_ASSIGNED');
    const existing = await TeamMembership.findOne({ team: team._id, user: leaderId, active: true });
    if (!existing) {
      await assertAvailableUsers([leaderId], { leader: true });
      if ((await activeMemberCount(team._id)) + 1 > (rest.capacity ?? team.capacity)) throw badRequest('TEAM_CAPACITY_EXCEEDED');
    } else {
      const u = await User.findById(leaderId);
      if (u?.role !== 'team_leader') throw badRequest('LEADER_ROLE_REQUIRED');
    }
    await TeamMembership.updateMany({ team: team._id, role: 'leader' }, { role: 'member' });
    await TeamMembership.findOneAndUpdate({ team: team._id, user: leaderId }, { role: 'leader', active: true, addedBy: req.user!._id, $unset: { leftAt: 1 } }, { upsert: true });
    joinTeamRoom(leaderId, String(team._id));
    team.leader = leaderId;
  }
  Object.assign(team, rest);
  await team.save();
  await audit(req.user, 'team.update', 'RescueTeam', team._id, req.body, req);
  emitToRoles(['admin'], 'team:changed', { id: String(team._id) });
  return ok(res, await serializeTeam(team, true));
});

export const addMembers = asyncHandler(async (req, res) => {
  const team = await RescueTeam.findById(req.params.id);
  if (!team) throw notFound('TEAM_NOT_FOUND');
  const ids = [...new Set<string>(req.body.userIds)];
  if ((await activeMemberCount(team._id)) + ids.length > team.capacity) throw badRequest('TEAM_CAPACITY_EXCEEDED', 'Adding these members would exceed the team capacity');
  await assertAvailableUsers(ids, { ignoreTeam: String(team._id) });
  for (const userId of ids) {
    await TeamMembership.findOneAndUpdate(
      { team: team._id, user: userId },
      { role: 'member', active: true, addedBy: req.user!._id, joinedAt: new Date(), $unset: { leftAt: 1 } },
      { upsert: true },
    );
    joinTeamRoom(userId, String(team._id));
  }
  await audit(req.user, 'team.add_members', 'RescueTeam', team._id, { userIds: ids }, req);
  await notifyUsers(ids, {
    type: 'team_membership_added',
    params: { team: team.name },
    message: `You were added to team ${team.name}`,
    link: '/responder/team',
    entityType: 'team',
    entityId: String(team._id),
  });
  emitToRoles(['admin'], 'team:changed', { id: String(team._id) });
  return ok(res, await serializeTeam(team, true));
});

export const removeMember = asyncHandler(async (req, res) => {
  const team = await RescueTeam.findById(req.params.id);
  if (!team) throw notFound('TEAM_NOT_FOUND');
  const m = await TeamMembership.findOne({ team: team._id, user: req.params.userId, active: true });
  if (!m) throw notFound('MEMBER_NOT_FOUND');
  if (m.role === 'leader') throw badRequest('CANNOT_REMOVE_LEADER', 'Assign a different leader before removing the current leader');
  m.active = false;
  m.leftAt = new Date();
  await m.save();
  leaveTeamRoom(String(m.user), String(team._id));
  await audit(req.user, 'team.remove_member', 'RescueTeam', team._id, { userId: String(m.user) }, req);
  await notifyUsers([m.user], { type: 'team_membership_removed', params: { team: team.name }, message: `You were removed from team ${team.name}`, entityType: 'team', entityId: String(team._id) });
  emitToRoles(['admin'], 'team:changed', { id: String(team._id) });
  return ok(res, await serializeTeam(team, true));
});

export const updateTeamLocation = asyncHandler(async (req, res) => {
  const team = await RescueTeam.findById(req.params.id);
  if (!team) throw notFound('TEAM_NOT_FOUND');
  if (String(team.leader) !== String(req.user!._id)) throw forbidden('FORBIDDEN_NOT_LEADER', 'Only the team leader can share the team location');
  team.lastLocation = pointFrom(req.body);
  team.lastLocationAt = new Date();
  await team.save();
  emitToRoles(['admin'], 'team:changed', { id: String(team._id) });
  return ok(res, { updated: true, at: team.lastLocationAt });
});
