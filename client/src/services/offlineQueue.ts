/**
 * Offline report queue stored in IndexedDB.
 * Every queued report carries a client-generated request id. The server treats that id as an idempotency key,
 * so retrying after a lost response can never create a second emergency.
 */
export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';
export interface QueuedReport {
  clientRequestId: string;
  kind: 'sos' | 'report';
  payload: Record<string, unknown>;
  createdAt: string;
  status: QueueStatus;
  attempts: number;
  emergencyId?: string;
  serverId?: string;
  error?: string;
  syncedAt?: string;
}

const DB_NAME = 'resqconnect';
const STORE = 'pending_reports';
const listeners = new Set<() => void>();
export const subscribeQueue = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const notify = () => listeners.forEach((f) => f());

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'clientRequestId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(r.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return `rq-${c.randomUUID()}`;
  return `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function enqueue(kind: QueuedReport['kind'], payload: Record<string, unknown>, clientRequestId = newRequestId()): Promise<QueuedReport> {
  const item: QueuedReport = { clientRequestId, kind, payload: { ...payload, clientRequestId }, createdAt: new Date().toISOString(), status: 'pending', attempts: 0 };
  await tx('readwrite', (s) => s.put(item));
  notify();
  return item;
}
export async function listQueue(): Promise<QueuedReport[]> {
  const all = await tx<QueuedReport[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function updateItem(id: string, patch: Partial<QueuedReport>): Promise<void> {
  const cur = await tx<QueuedReport | undefined>('readonly', (s) => s.get(id));
  if (!cur) return;
  await tx('readwrite', (s) => s.put({ ...cur, ...patch }));
  notify();
}
export async function removeItem(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  notify();
}

export type Sender = (item: QueuedReport) => Promise<{ id: string; emergencyId: string }>;
export interface SendFailure { status: number; code?: string; message?: string }

let syncing = false;
/**
 * Try to send every pending/failed-by-network item. Network errors keep the item "pending" (retry later);
 * server rejections (4xx) mark it "failed" with the reason so the user can see and delete it.
 */
export async function syncQueue(send: Sender, isNetworkError: (e: unknown) => boolean, describe: (e: unknown) => string): Promise<{ synced: number; failed: number; remaining: number }> {
  if (syncing) return { synced: 0, failed: 0, remaining: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = (await listQueue()).filter((i) => i.status === 'pending' || i.status === 'syncing').reverse();
    for (const item of items) {
      await updateItem(item.clientRequestId, { status: 'syncing', attempts: item.attempts + 1 });
      try {
        const res = await send(item);
        await updateItem(item.clientRequestId, { status: 'synced', serverId: res.id, emergencyId: res.emergencyId, syncedAt: new Date().toISOString(), error: undefined });
        synced += 1;
      } catch (e) {
        if (isNetworkError(e)) await updateItem(item.clientRequestId, { status: 'pending' });
        else {
          await updateItem(item.clientRequestId, { status: 'failed', error: describe(e) });
          failed += 1;
        }
      }
    }
    const remaining = (await listQueue()).filter((i) => i.status === 'pending').length;
    return { synced, failed, remaining };
  } finally {
    syncing = false;
  }
}
