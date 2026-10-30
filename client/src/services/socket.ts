import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket | null {
  const token = tokenStore.get();
  if (!token) return null;
  if (socket) socket.disconnect();
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || undefined;
  socket = io(base, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10000 });
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
export const getSocket = () => socket;
