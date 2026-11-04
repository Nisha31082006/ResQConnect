import type { FilterQuery } from 'mongoose';
import { Notification } from '../models';
import type { INotification } from '../models/Notification';
import { serializeNotification } from '../services/notification.service';
import { notFound } from '../utils/AppError';
import { asyncHandler, ok, pageMeta, parsePaging } from '../utils/http';

export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, { page: 1, limit: 20, maxLimit: 100 });
  const filter: FilterQuery<INotification> = { user: req.user!._id };
  if ((req.query as { unread?: boolean }).unread) filter.read = false;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user!._id, read: false }),
  ]);
  return ok(res, items.map(serializeNotification), { ...pageMeta(page, limit, total), unread });
});

export const markRead = asyncHandler(async (req, res) => {
  // Scoped to the owner: users can never touch someone else's notifications.
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user!._id }, { read: true, readAt: new Date() }, { new: true });
  if (!n) throw notFound('NOTIFICATION_NOT_FOUND');
  return ok(res, serializeNotification(n));
});

export const markAllRead = asyncHandler(async (req, res) => {
  const r = await Notification.updateMany({ user: req.user!._id, read: false }, { read: true, readAt: new Date() });
  return ok(res, { updated: r.modifiedCount });
});
