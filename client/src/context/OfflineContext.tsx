import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, http, multipart } from '../services/api';
import { enqueue, listQueue, subscribeQueue, syncQueue, type QueuedReport } from '../services/offlineQueue';
import { errorMessage } from '../utils/errors';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

interface SubmitResult { queued: boolean; id?: string; emergencyId?: string; clientRequestId: string }
interface OfflineState {
  online: boolean;
  queue: QueuedReport[];
  pendingCount: number;
  syncing: boolean;
  syncNow: () => Promise<void>;
  /** Send now when online, otherwise (or when the network drops mid-request) store locally for later. */
  submitReport: (kind: 'sos' | 'report', payload: Record<string, unknown>, files?: File[]) => Promise<SubmitResult>;
}
const Ctx = createContext<OfflineState | null>(null);

const sendItem = async (item: QueuedReport) => {
  const url = item.kind === 'sos' ? '/sos' : '/emergencies';
  const body = { ...item.payload, source: 'offline_sync' };
  const res = await http.post(url, body);
  return { id: res.data.data.id as string, emergencyId: res.data.data.emergencyId as string };
};

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const toast = useToast();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queue, setQueue] = useState<QueuedReport[]>([]);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(() => void listQueue().then(setQueue).catch(() => undefined), []);
  useEffect(() => {
    refresh();
    return subscribeQueue(refresh);
  }, [refresh]);

  const syncNow = useCallback(async () => {
    if (!user || busy.current || !navigator.onLine) return;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await syncQueue(sendItem, (e) => e instanceof ApiError && e.isNetwork, (e) => errorMessage(e, t));
      if (r.synced > 0) toast.success(t('offline.syncedToast', { count: r.synced }));
      if (r.failed > 0) toast.error(t('offline.failedToast', { count: r.failed }));
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [user, t, toast]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void syncNow();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [syncNow]);

  // Retry on login and periodically while something is waiting (covers captive portals / flaky links).
  const pendingCount = queue.filter((q) => q.status === 'pending' || q.status === 'syncing').length;
  useEffect(() => {
    if (user && pendingCount > 0) void syncNow();
  }, [user, pendingCount, syncNow]);
  useEffect(() => {
    if (!user || pendingCount === 0) return;
    const id = setInterval(() => void syncNow(), 30000);
    return () => clearInterval(id);
  }, [user, pendingCount, syncNow]);

  const submitReport = useCallback<OfflineState['submitReport']>(
    async (kind, payload, files = []) => {
      const { newRequestId } = await import('../services/offlineQueue');
      const clientRequestId = (payload.clientRequestId as string | undefined) ?? newRequestId();
      const body = { ...payload, clientRequestId };
      const queueIt = async (): Promise<SubmitResult> => {
        await enqueue(kind, body, clientRequestId);
        return { queued: true, clientRequestId };
      };
      if (!navigator.onLine) return queueIt();
      try {
        const url = kind === 'sos' ? '/sos' : '/emergencies';
        const res = files.length ? await http.post(url, multipart(body, files)) : await http.post(url, body);
        return { queued: false, id: res.data.data.id, emergencyId: res.data.data.emergencyId, clientRequestId };
      } catch (e) {
        // Lost connection mid-request: the request id makes a later retry safe even if the server did receive it.
        if (e instanceof ApiError && e.isNetwork) return queueIt();
        throw e;
      }
    },
    [],
  );

  const value = useMemo(() => ({ online, queue, pendingCount, syncing, syncNow, submitReport }), [online, queue, pendingCount, syncing, syncNow, submitReport]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useOffline = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('OfflineProvider missing');
  return c;
};
