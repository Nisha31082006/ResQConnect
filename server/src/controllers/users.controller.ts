import bcrypt from 'bcryptjs';
import type { FilterQuery } from 'mongoose';
import { env } from '../config/env';
import { Assignment, TeamMembership } from '../models';
import { User, type IUser } from '../models/User';
import { audit } from '../services/audit.service';
import { notifyUsers } from '../services/notification.service';
import { conflict, notFound, badRequest } from '../utils/AppError';
import { asyncHandler, created, escapeRegex, ok, pageMeta, parsePaging } from '../utils/http';
import { serializeUser } from './auth.controller';

export const listUsers = asyncHandler(async (req, res) => {
  const q = req.query as unknown as { search?: string; role?: string; status?: string; sort?: string; order: 'asc' | 'desc' };
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>);
  const filter: FilterQuery<IUser> = {};
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const sortField = ['name', 'email', 'role', 'createdAt', 'status'].includes(q.sort ?? '') ? (q.sort as string) : 'createdAt';
  const [items, total] = await Promise.all([
    User.find(filter).sort({ [sortField]: q.order === 'asc' ? 1 : -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return ok(res, items.map(serializeUser), pageMeta(page, limit, total));
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, skills } = req.body;
  if (await User.exists({ email })) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  const user = await User.create({ name, email, phone, role, skills: skills ?? [], status: 'active', passwordHash: await bcrypt.hash(password, env.bcryptRounds) });
  await audit(req.user, 'user.create', 'User', user._id, { role }, req);
  return created(res, serializeUser(user));
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('USER_NOT_FOUND');
  if (String(user._id) === String(req.user!._id) && (req.body.role || req.body.status)) {
    throw badRequest('CANNOT_CHANGE_OWN_ACCESS', 'You cannot change your own role or status');
  }
  const before = { role: user.role, status: user.status };
  Object.assign(user, req.body);
  await user.save();
  await audit(req.user, 'user.update', 'User', user._id, { before, after: { role: user.role, status: user.status } }, req);
  if (before.status === 'pending' && user.status === 'active') {
    await notifyUsers([user._id], { type: 'account_approved', message: 'Your account was approved', link: '/' });
  }
  return ok(res, serializeUser(user));
});

/** Volunteers with skills, availability and current workload - used by the allocation screens. */
export const listVolunteers = asyncHandler(async (_req, res) => {
  const volunteers = await User.find({ role: { $in: ['volunteer', 'team_leader'] }, status: 'active' }).sort({ name: 1 });
  const memberships = await TeamMembership.find({ user: { $in: volunteers.map((v) => v._id) }, active: true }).populate('team', 'name');
  const activeAssignments = await Assignment.find({ status: 'active' }).select('team volunteers');
  const out = volunteers.map((v) => {
    const mine = memberships.filter((m) => String(m.user) === String(v._id));
    const teamIds = mine.map((m) => String((m.team as unknown as { _id: unknown })._id));
    const workload = activeAssignments.filter((a) => (a.team && teamIds.includes(String(a.team))) || a.volunteers.some((x) => String(x) === String(v._id))).length;
    return {
      ...serializeUser(v),
      teams: mine.map((m) => ({ id: String((m.team as unknown as { _id: unknown })._id), name: (m.team as unknown as { name: string }).name })),
      workload,
    };
  });
  return ok(res, out);
});

/** Volunteers / team leaders share their base location so team recommendations can use distance. */
export const updateMyLocation = asyncHandler(async (req, res) => {
  const { lat, lng } = req.body as { lat: number; lng: number };
  const updatedAt = new Date();
  const result = await User.updateOne({ _id: req.user!._id }, { homeLocation: { type: 'Point', coordinates: [lng, lat] }, locationUpdatedAt: updatedAt });
  if (result.matchedCount === 0) throw notFound('USER_NOT_FOUND');
  return ok(res, { lat, lng, updatedAt });
});

export const getMyLocation = asyncHandler(async (req, res) => {
  const u = await User.findById(req.user!._id);
  const c = u?.homeLocation?.coordinates;
  return ok(res, c && c.length === 2 ? { lat: c[1], lng: c[0], updatedAt: u?.locationUpdatedAt } : null);
});
