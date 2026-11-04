import type { Types } from 'mongoose';
import { Notification, User } from '../models';
import type { Role } from '../models/shared';
import { emitToUser } from '../sockets';

export interface NotificationInput {
  type: string;
  params?: Record<string, unknown>;
  message: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

type IdLike = Types.ObjectId | string;

/** Persist in-app notifications first (MongoDB is the source of truth), then push them over Socket.IO. */
export async function notifyUsers(userIds: IdLike[], input: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  if (unique.length === 0) return;
  const docs = await Notification.insertMany(
    unique.map((user) => ({ user, type: input.type, params: input.params ?? {}, message: input.message, link: input.link, entityType: input.entityType, entityId: input.entityId })),
  );
  for (const doc of docs) {
    emitToUser(String(doc.user), 'notification:new', serializeNotification(doc));
  }
}

export async function notifyRoles(roles: Role[], input: NotificationInput): Promise<void> {
  const users = await User.find({ role: { $in: roles }, status: 'active' }).select('_id');
  await notifyUsers(users.map((u) => u._id), input);
}

export const serializeNotification = (n: {
  _id: unknown;
  type: string;
  params?: unknown;
  message: string;
  link?: string | null;
  read?: boolean;
  createdAt?: Date;
}) => ({
  id: String(n._id),
  type: n.type,
  params: n.params ?? {},
  message: n.message,
  link: n.link ?? null,
  read: Boolean(n.read),
  createdAt: n.createdAt,
});
