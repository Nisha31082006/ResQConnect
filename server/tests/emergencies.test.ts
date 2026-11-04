import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import * as H from './helpers';
import { api, clearDb, createReport, createSos, makeUser, PNG_BYTES, reportBody, sosBody, startDb, stopDb } from './helpers';
import { Emergency, EmergencyRevision } from '../src/models';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe('emergency reports (Feature 1)', () => {
  it('creates a report with a unique emergency ID, stores it and returns its status', async () => {
    const citizen = await makeUser('citizen');
    const res = await request(api()).post('/api/emergencies').set(citizen.auth).send(reportBody());
    expect(res.status).toBe(201);
    expect(res.body.data.emergencyId).toMatch(/^RQ-\d{6}-[A-Z0-9]{5}$/);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.kind).toBe('normal');
    expect(res.body.data.recommendedPriority.level).toBeTruthy();
    expect(await Emergency.countDocuments()).toBe(1);

    const second = await createReport(citizen);
    expect(second.emergencyId).not.toBe(res.body.data.emergencyId);
  });

  it('validates the form server-side with field-level error codes', async () => {
    const citizen = await makeUser('citizen');
    const res = await request(api()).post('/api/emergencies').set(citizen.auth).send({ type: 'unicorn', description: 'short', affectedCount: 0, location: { lat: 200, lng: 10 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['type', 'description', 'affectedCount', 'location.lat']));
    expect(await Emergency.countDocuments()).toBe(0);
  });

  it('requires some contact detail', async () => {
    const citizen = await makeUser('citizen');
    const res = await request(api()).post('/api/emergencies').set(citizen.auth).send(reportBody({ contact: {} }));
    expect(res.status).toBe(400);
  });

  it('lets only citizens (or admins) file reports', async () => {
    const volunteer = await makeUser('volunteer');
    const res = await request(api()).post('/api/emergencies').set(volunteer.auth).send(reportBody());
    expect(res.status).toBe(403);
    expect((await request(api()).post('/api/emergencies').send(reportBody())).status).toBe(401);
  });

  it('accepts a valid image as evidence and rejects spoofed or unsupported files', async () => {
    const citizen = await makeUser('citizen');
    const good = await request(api())
      .post('/api/emergencies')
      .set(citizen.auth)
      .field('data', JSON.stringify(reportBody()))
      .attach('evidence', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });
    expect(good.status).toBe(201);
    expect(good.body.data.evidence).toHaveLength(1);
    const file = await request(api()).get(good.body.data.evidence[0].url).set(citizen.auth);
    expect(file.status).toBe(200);
    expect((await request(api()).get(good.body.data.evidence[0].url)).status).toBe(401);

    const spoof = await request(api())
      .post('/api/emergencies')
      .set(citizen.auth)
      .field('data', JSON.stringify(reportBody()))
      .attach('evidence', Buffer.from('<?php echo 1; ?>'), { filename: 'x.png', contentType: 'image/png' });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error.code).toBe('INVALID_FILE_CONTENT');

    const exe = await request(api())
      .post('/api/emergencies')
      .set(citizen.auth)
      .field('data', JSON.stringify(reportBody()))
      .attach('evidence', Buffer.from('MZ'), { filename: 'virus.exe', contentType: 'application/octet-stream' });
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await Emergency.countDocuments()).toBe(1);
  });
});

describe('SOS (Feature 2)', () => {
  it('creates a simplified SOS that is flagged as SOS and high-risk by default, and shows up on the admin list first', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    await createReport(citizen);
    const sos = await createSos(citizen);
    const list = await request(api()).get('/api/emergencies?kind=sos').set(admin.auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(sos.id);
    expect(list.body.data[0].kind).toBe('sos');
    expect(list.body.data[0].dangerToLife).toBe(true);
    const sorted = await request(api()).get('/api/emergencies?sort=priority&order=desc').set(admin.auth);
    expect(sorted.body.data[0].kind).toBe('sos');
  });

  it('does not claim that any emergency service was contacted', async () => {
    const citizen = await makeUser('citizen');
    const res = await request(api()).post('/api/sos').set(citizen.auth).send(sosBody());
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/(police|ambulance|fire department).*(notified|contacted|dispatched)/);
    expect(res.body.data.status).toBe('pending');
  });
});

describe('idempotent creation (Feature 4)', () => {
  it('returns the same report when the same clientRequestId is retried', async () => {
    const citizen = await makeUser('citizen');
    const body = sosBody({ clientRequestId: 'client-req-0001-abcdef' });
    const a = await request(api()).post('/api/sos').set(citizen.auth).send(body);
    const b = await request(api()).post('/api/sos').set(citizen.auth).send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.meta.idempotent).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await Emergency.countDocuments()).toBe(1);
  });

  it('handles concurrent retries without creating duplicates (needs a database that enforces the partial unique index)', async (ctx) => {
    if (!H.uniqueIndexEnforced) ctx.skip();
    const citizen = await makeUser('citizen');
    const body = reportBody({ clientRequestId: 'client-req-concurrent-1' });
    const results = await Promise.all([0, 1, 2, 3].map(() => request(api()).post('/api/emergencies').set(citizen.auth).send(body)));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    expect(await Emergency.countDocuments()).toBe(1);
  });

  it("does not let another user's request id collide with or reveal a report", async () => {
    const a = await makeUser('citizen');
    const b = await makeUser('citizen', 'citizen2');
    const body = sosBody({ clientRequestId: 'client-req-shared-0001' });
    await request(api()).post('/api/sos').set(a.auth).send(body);
    const res = await request(api()).post('/api/sos').set(b.auth).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REQUEST_ID_CONFLICT');
  });

  it('marks offline-synced reports with their source', async () => {
    const citizen = await makeUser('citizen');
    const res = await request(api()).post('/api/emergencies').set(citizen.auth).send(reportBody({ source: 'offline_sync', clientRequestId: 'offline-0001-abcdef', occurredAt: new Date(Date.now() - 3600_000).toISOString() }));
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('offline_sync');
  });
});

describe('SOS updates and revision history (Feature 13)', () => {
  it('lets the owner update an active SOS, stores a revision with who/when, and flags priority for re-confirmation', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(citizen, sosBody({ affectedCount: 1, dangerToLife: false }));
    await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: 'high', overrideReason: 'checked by phone' });

    const before = (await request(api()).get(`/api/emergencies/${sos.id}`).set(citizen.auth)).body.data.recommendedPriority;
    const res = await request(api())
      .patch(`/api/emergencies/${sos.id}`)
      .set(citizen.auth)
      .send({ affectedCount: 12, dangerToLife: true, description: 'Twelve people now, one is injured', vulnerable: { injured: true, children: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.affectedCount).toBe(12);
    expect(res.body.data.revisionCount).toBe(1);
    expect(res.body.data.recommendedPriority.score).toBeGreaterThan(before.score);
    expect(res.body.data.priorityReviewNeeded).toBe(true);
    // The previously confirmed final priority is NOT silently changed.
    expect(res.body.data.finalPriority.level).toBe('high');

    const revs = await EmergencyRevision.find({ emergency: sos.id });
    expect(revs).toHaveLength(1);
    expect(String(revs[0].editedBy)).toBe(citizen.id);
    expect(revs[0].priorityRecalculated).toBe(true);

    const history = await request(api()).get(`/api/emergencies/${sos.id}/revisions`).set(citizen.auth);
    expect(history.status).toBe(200);
    expect(history.body.data[0].changes.affectedCount).toEqual({ from: 1, to: 12 });
  });

  it("forbids other citizens, volunteers and admins' impersonation from editing someone else's report", async () => {
    const owner = await makeUser('citizen');
    const other = await makeUser('citizen', 'other');
    const sos = await createSos(owner);
    const res = await request(api()).patch(`/api/emergencies/${sos.id}`).set(other.auth).send({ affectedCount: 99 });
    expect(res.status).toBe(403);
    expect((await Emergency.findById(sos.id))?.affectedCount).toBe(3);
    const vol = await makeUser('volunteer');
    expect((await request(api()).patch(`/api/emergencies/${sos.id}`).set(vol.auth).send({ affectedCount: 2 })).status).toBe(403);
    // Admins review and decide; they do not rewrite a citizen's own words.
    const admin = await makeUser('admin');
    expect((await request(api()).patch(`/api/emergencies/${sos.id}`).set(admin.auth).send({ affectedCount: 2 })).status).toBe(403);
  });

  it('rejects empty updates and cannot read other citizens’ reports', async () => {
    const owner = await makeUser('citizen');
    const other = await makeUser('citizen', 'other');
    const sos = await createSos(owner);
    expect((await request(api()).patch(`/api/emergencies/${sos.id}`).set(owner.auth).send({})).status).toBe(400);
    expect((await request(api()).get(`/api/emergencies/${sos.id}`).set(other.auth)).status).toBe(403);
    const list = await request(api()).get('/api/emergencies').set(other.auth);
    expect(list.body.data).toHaveLength(0);
  });

  it('notifies admins in-app when an SOS is updated', async () => {
    const owner = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(owner);
    await request(api()).patch(`/api/emergencies/${sos.id}`).set(owner.auth).send({ description: 'Water is now at chest level' });
    const n = await request(api()).get('/api/notifications').set(admin.auth);
    const types = n.body.data.map((x: { type: string }) => x.type);
    expect(types).toContain('sos_created');
    expect(types).toContain('sos_updated');
  });
});

describe('SMS fallback support (Feature 4)', () => {
  it('exposes the configurable emergency number publicly and never reports an SMS as delivered', async () => {
    const cfg = await request(api()).get('/api/config/public');
    expect(cfg.status).toBe(200);
    expect(cfg.body.data.smsEmergencyNumber).toBeTruthy();
    const citizen = await makeUser('citizen');
    const sos = await createSos(citizen);
    const res = await request(api()).post(`/api/emergencies/${sos.id}/sms-prepared`).set(citizen.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.sms.prepared).toBe(true);
    expect(res.body.data.sms.note).toMatch(/NOT confirmed/i);
    expect(JSON.stringify(res.body)).not.toMatch(/delivered":\s*true/);
  });

  it('keeps uploaded files outside of the public API surface (served only via authenticated route)', async () => {
    expect(fs.existsSync(path.resolve(process.env.UPLOAD_DIR!))).toBe(true);
    const res = await request(api()).get('/uploads/anything.png');
    expect(res.status).toBe(404);
  });
});
