import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { allModels, Emergency, User } from '../src/models';
import type { Role } from '../src/models/shared';

export const PASSWORD = 'Test@12345';
let mem: { stop: () => Promise<boolean>; getUri: () => string } | null = null;
let app: Express | null = null;
/** True when the database enforced the partial unique index used for request idempotency (real MongoDB does; some compatible servers do not). */
export let uniqueIndexEnforced = false;
/** True when concurrent conditional updates on one document are atomic (guaranteed by real MongoDB, not by every compatible server). */
export let atomicUpdates = false;

/** Connects to TEST_MONGODB_URI when set, otherwise starts an in-memory MongoDB (mongodb-memory-server). */
export async function startDb(): Promise<void> {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    mem = server;
    uri = server.getUri('resq_test');
  }
  if (mongoose.connection.readyState !== 1) await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  await mongoose.connection.dropDatabase();
  // Create indexes one by one; some MongoDB-compatible servers do not support every index type, which must not abort the suite.
  for (const m of allModels as unknown as { schema: { indexes(): [object, object][] }; collection: { createIndex(f: object, o: object): Promise<unknown> } }[]) {
    for (const [fields, options] of m.schema.indexes()) await m.collection.createIndex(fields, options).catch(() => undefined);
  }
  await probeUniqueIndex();
  await probeAtomicUpdates();
}

async function probeAtomicUpdates() {
  const col = mongoose.connection.collection('_atomic_probe');
  await col.deleteMany({});
  const { insertedId } = await col.insertOne({ n: 0 });
  await Promise.all(Array.from({ length: 20 }, () => col.findOneAndUpdate({ _id: insertedId, n: { $lt: 10 } }, { $inc: { n: 1 } })));
  atomicUpdates = ((await col.findOne({ _id: insertedId })) as unknown as { n: number }).n === 10;
  await col.drop().catch(() => undefined);
}

async function probeUniqueIndex() {
  const idx = await Emergency.collection.indexes().catch(() => []);
  uniqueIndexEnforced = idx.some((i) => i.name === 'clientRequestId_1' && i.unique);
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect();
  if (mem) await mem.stop();
  mem = null;
}

export async function clearDb(): Promise<void> {
  await Promise.all((allModels as unknown as { deleteMany(f: object): Promise<unknown> }[]).map((m) => m.deleteMany({})));
}

export const api = (): Express => (app ??= createApp());

export async function makeUser(role: Role, name: string = role, extra: Record<string, unknown> = {}) {
  const email = `${name}.${Math.random().toString(36).slice(2, 8)}@test.local`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  const user = await User.create({ name, email, role, status: 'active', passwordHash: await bcrypt.hash(PASSWORD, 4), phone: '+919800000000', ...extra });
  const res = await request(api()).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed in test helper: ${res.status} ${JSON.stringify(res.body)}`);
  const token: string = res.body.data.token;
  return { user, id: String(user._id), email, token, auth: { Authorization: `Bearer ${token}` } };
}
export type TestUser = Awaited<ReturnType<typeof makeUser>>;

export const CHENNAI = { lat: 13.0827, lng: 80.2707 };

export const reportBody = (over: Record<string, unknown> = {}) => ({
  type: 'flood',
  description: 'Street is flooded and families need help getting out.',
  affectedCount: 6,
  contact: { name: 'Reporter', phone: '+919811111111' },
  location: { ...CHENNAI, address: 'Test street' },
  ...over,
});

export const sosBody = (over: Record<string, unknown> = {}) => ({
  type: 'trapped',
  description: 'Trapped on the roof, water rising',
  affectedCount: 3,
  contact: { phone: '+919822222222' },
  location: { ...CHENNAI },
  ...over,
});

export async function createReport(user: TestUser, body: Record<string, unknown> = reportBody(), path = '/api/emergencies') {
  const res = await request(api()).post(path).set(user.auth).send(body);
  if (res.status >= 300) throw new Error(`createReport failed ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; emergencyId: string; status: string };
}
export const createSos = (user: TestUser, body: Record<string, unknown> = sosBody()) => createReport(user, body, '/api/sos');

/** A 1x1 PNG, good enough for upload tests. */
export const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
