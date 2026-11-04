import { io, type Socket } from 'socket.io-client';
import { tokenStore, apiRoot, HASH_MODE } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket | null {
  const token = tokenStore.get();
  if (!token) return null;
  if (socket) socket.disconnect();
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const opts = { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10000 };
  socket = HASH_MODE && !configured
    ? io({ ...opts, path: `${apiRoot()}/socket.io` })
    : io(configured || undefined, opts);
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
export const getSocket = () => socket;
