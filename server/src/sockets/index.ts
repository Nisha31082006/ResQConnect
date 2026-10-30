import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { TeamMembership, User } from '../models';

let io: Server | null = null;

export const getIO = () => io;

export const rooms = {
  user: (id: string) => `user:${id}`,
  role: (role: string) => `role:${role}`,
  team: (id: string) => `team:${id}`,
  all: 'authenticated',
};

/**
 * Socket.IO is authenticated with the same JWT as the REST API (handshake `auth.token`).
 * Rooms: user:<id>, role:<role>, team:<id>, authenticated.
 * Events only carry minimal, non-sensitive payloads; clients re-fetch details through the REST API,
 * where role-based visibility and location precision are enforced.
 */
export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: env.clientOrigins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? '';
      if (!token) return next(new Error('AUTH_REQUIRED'));
      const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
      const user = await User.findById(payload.sub).select('role status');
      if (!user || user.status !== 'active') return next(new Error('AUTH_INVALID'));
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      return next();
    } catch {
      return next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, role } = socket.data as { userId: string; role: string };
    socket.join(rooms.user(userId));
    socket.join(rooms.role(role));
    socket.join(rooms.all);
    const memberships = await TeamMembership.find({ user: userId, active: true }).select('team');
    memberships.forEach((m) => socket.join(rooms.team(String(m.team))));
    socket.emit('connected', { userId, role });
  });

  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(rooms.user(userId)).emit(event, payload);
}

export function emitToRoles(roles: string[], event: string, payload: unknown) {
  if (!io) return;
  roles.forEach((r) => io!.to(rooms.role(r)).emit(event, payload));
}

export function emitToTeams(teamIds: string[], event: string, payload: unknown) {
  if (!io) return;
  teamIds.forEach((t) => io!.to(rooms.team(t)).emit(event, payload));
}

/** Notify every authenticated client that map data changed (no data included - clients re-fetch with their own permissions). */
export function emitMapRefresh(kind: string, id?: string) {
  io?.to(rooms.all).emit('map:refresh', { kind, id });
}

/** Keep a user's live sockets in sync after team membership changes. */
export function joinTeamRoom(userId: string, teamId: string) {
  io?.in(rooms.user(userId)).socketsJoin(rooms.team(teamId));
}
export function leaveTeamRoom(userId: string, teamId: string) {
  io?.in(rooms.user(userId)).socketsLeave(rooms.team(teamId));
}

export async function closeSocket(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = null;
}
