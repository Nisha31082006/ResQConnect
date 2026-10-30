import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { api, clearDb, makeUser, sosBody, startDb, stopDb, type TestUser } from './helpers';
import { closeSocket, initSocket } from '../src/sockets';

let server: http.Server;
let url = '';
const open: Socket[] = [];

beforeAll(async () => {
  await startDb();
  server = http.createServer(api());
  initSocket(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  open.forEach((s) => s.close());
  await closeSocket();
  await new Promise((r) => server.close(r));
  await stopDb();
});
beforeEach(clearDb);

const connectAs = (u: TestUser | null) =>
  new Promise<Socket>((resolve, reject) => {
    const s = connect(url, { auth: u ? { token: u.token } : {}, transports: ['websocket'], reconnection: false });
    open.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => {
      s.close();
      reject(e);
    });
  });
const waitFor = (s: Socket, event: string, ms = 1500) =>
  new Promise<unknown>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

describe('Socket.IO security and delivery', () => {
  it('rejects unauthenticated and invalid-token connections', async () => {
    await expect(connectAs(null)).rejects.toThrow(/AUTH_REQUIRED/);
    await expect(connectAs({ token: 'garbage' } as TestUser)).rejects.toThrow(/AUTH_INVALID/);
  });

  it('delivers SOS events to administrators and the reporter, but not to other citizens', async () => {
    const admin = await makeUser('admin');
    const owner = await makeUser('citizen');
    const other = await makeUser('citizen', 'other');
    const [sAdmin, sOwner, sOther] = await Promise.all([connectAs(admin), connectAs(owner), connectAs(other)]);
    await new Promise((r) => setTimeout(r, 100)); // rooms are joined right after connect
    let leaked = false;
    sOther.on('sos:created', () => (leaked = true));
    const pAdmin = waitFor(sAdmin, 'sos:created');
    const pOwner = waitFor(sOwner, 'sos:created');
    const res = await request(api()).post('/api/sos').set(owner.auth).send(sosBody());
    expect(res.status).toBe(201);
    const payload = (await pAdmin) as { emergencyId: string; contact?: unknown; location?: unknown };
    expect(payload.emergencyId).toBe(res.body.data.emergencyId);
    // Events carry no personal data or coordinates; clients re-fetch through the permission-checked REST API.
    expect(payload.contact).toBeUndefined();
    expect(payload.location).toBeUndefined();
    await pOwner;
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
  });

  it('delivers notification events only to the targeted user', async () => {
    const admin = await makeUser('admin');
    const citizen = await makeUser('citizen');
    const sAdmin = await connectAs(admin);
    const sCitizen = await connectAs(citizen);
    await new Promise((r) => setTimeout(r, 100));
    let citizenGot = false;
    sCitizen.on('notification:new', () => (citizenGot = true));
    const p = waitFor(sAdmin, 'notification:new');
    await request(api()).post('/api/sos').set(citizen.auth).send(sosBody());
    await p;
    await new Promise((r) => setTimeout(r, 200));
    expect(citizenGot).toBe(false);
  });
});
