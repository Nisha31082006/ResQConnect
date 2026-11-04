import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { signToken } from '../middleware/auth';
import { User, UserDoc } from '../models/User';
import { audit } from '../services/audit.service';
import { notifyRoles } from '../services/notification.service';
import { badRequest, conflict, forbidden, unauthorized } from '../utils/AppError';
import { asyncHandler, created, ok } from '../utils/http';

export const serializeUser = (u: UserDoc) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  phone: u.phone ?? null,
  role: u.role,
  status: u.status,
  preferredLanguage: u.preferredLanguage,
  skills: u.skills,
  availability: u.availability,
  hasLocation: Boolean(u.homeLocation?.coordinates?.length),
  createdAt: u.createdAt,
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, preferredLanguage, skills } = req.body;
  if (await User.exists({ email })) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  // Citizens are active immediately; operational roles need administrator approval before they can sign in.
  const status = role === 'citizen' ? 'active' : 'pending';
  const user = await User.create({ name, email, phone, passwordHash, role, status, preferredLanguage, skills: skills ?? [] });
  await audit({ id: user._id, role: user.role }, 'user.register', 'User', user._id, { role, status }, req);
  if (status === 'pending') {
    await notifyRoles(['admin'], {
      type: 'user_pending_approval',
      params: { name, role },
      message: `${name} registered as ${role} and awaits approval`,
      link: '/admin/users',
      entityType: 'user',
      entityId: String(user._id),
    });
  }
  if (status === 'pending') return created(res, { user: serializeUser(user), token: null, pendingApproval: true });
  return created(res, { user: serializeUser(user), token: signToken(String(user._id), user.role), pendingApproval: false });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same error for unknown email and wrong password: do not reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
  if (user.status === 'suspended') throw forbidden('AUTH_SUSPENDED', 'This account has been suspended');
  if (user.status === 'pending') throw forbidden('AUTH_PENDING_APPROVAL', 'This account is awaiting administrator approval');
  user.lastLoginAt = new Date();
  await user.save();
  return ok(res, { user: serializeUser(user), token: signToken(String(user._id), user.role) });
});

export const me = asyncHandler(async (req, res) => ok(res, { user: serializeUser(req.user!) }));

export const updateMe = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { skills, availability } = req.body;
  if ((skills !== undefined || availability !== undefined) && !['volunteer', 'team_leader'].includes(user.role)) {
    throw badRequest('PROFILE_FIELD_NOT_ALLOWED', 'Skills and availability only apply to volunteers and team leaders');
  }
  Object.assign(user, req.body);
  await user.save();
  return ok(res, { user: serializeUser(user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user!._id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw badRequest('AUTH_WRONG_PASSWORD', 'Current password is incorrect');
  user.passwordHash = await bcrypt.hash(req.body.newPassword, env.bcryptRounds);
  await user.save();
  await audit({ id: user._id, role: user.role }, 'user.password_change', 'User', user._id, {}, req);
  return ok(res, { changed: true });
});
