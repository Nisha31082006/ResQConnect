import { beforeEach, describe, expect, it } from 'vitest';
import { enqueue, listQueue, removeItem, syncQueue, type QueuedReport } from '../services/offlineQueue';

const net = (e: unknown) => (e as { net?: boolean }).net === true;
const describeErr = (e: unknown) => String((e as Error).message);

beforeEach(async () => {
  for (const i of await listQueue()) await removeItem(i.clientRequestId);
});

describe('offline queue', () => {
  it('stores a report with its idempotency key and pending status', async () => {
    const item = await enqueue('sos', { type: 'medical', description: 'help' }, 'rq-test-0001');
    expect(item.clientRequestId).toBe('rq-test-0001');
    expect((await listQueue())[0]).toMatchObject({ kind: 'sos', status: 'pending', attempts: 0, payload: { clientRequestId: 'rq-test-0001' } });
  });

  it('sends queued items once, marks them synced and keeps the same request id', async () => {
    await enqueue('report', { type: 'flood' }, 'rq-test-0002');
    const seen: string[] = [];
    const r = await syncQueue(async (i: QueuedReport) => { seen.push(String(i.payload.clientRequestId)); return { id: 'srv1', emergencyId: 'EM-1' }; }, net, describeErr);
    expect(r).toEqual({ synced: 1, failed: 0, remaining: 0 });
    expect(seen).toEqual(['rq-test-0002']);
    expect((await listQueue())[0]).toMatchObject({ status: 'synced', emergencyId: 'EM-1', serverId: 'srv1' });
    const again = await syncQueue(async () => { throw new Error('must not resend'); }, net, describeErr);
    expect(again.synced).toBe(0);
  });

  it('keeps items pending on network errors and retries with the SAME request id', async () => {
    await enqueue('sos', { type: 'fire' }, 'rq-test-0003');
    const ids: string[] = [];
    await syncQueue(async (i) => { ids.push(String(i.payload.clientRequestId)); throw Object.assign(new Error('offline'), { net: true }); }, net, describeErr);
    expect((await listQueue())[0]).toMatchObject({ status: 'pending', attempts: 1 });
    await syncQueue(async (i) => { ids.push(String(i.payload.clientRequestId)); return { id: 's', emergencyId: 'EM-2' }; }, net, describeErr);
    expect(ids).toEqual(['rq-test-0003', 'rq-test-0003']);
    expect((await listQueue())[0].status).toBe('synced');
  });

  it('marks server rejections as failed with the reason, without retrying forever', async () => {
    await enqueue('report', { type: 'x' }, 'rq-test-0004');
    const r = await syncQueue(async () => { throw new Error('Validation failed'); }, net, describeErr);
    expect(r.failed).toBe(1);
    expect((await listQueue())[0]).toMatchObject({ status: 'failed', error: 'Validation failed' });
    const again = await syncQueue(async () => { throw new Error('must not retry'); }, net, describeErr);
    expect(again.failed).toBe(0);
  });

  it('sends oldest first', async () => {
    await enqueue('report', { n: 1 }, 'rq-test-a001');
    await new Promise((r) => setTimeout(r, 5));
    await enqueue('report', { n: 2 }, 'rq-test-a002');
    const order: number[] = [];
    await syncQueue(async (i) => { order.push(Number(i.payload.n)); return { id: 'x', emergencyId: 'E' }; }, net, describeErr);
    expect(order).toEqual([1, 2]);
  });
});
