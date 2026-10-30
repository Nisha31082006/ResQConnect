import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { scoreDuplicate } from '../src/services/duplicate.service';
import { api, clearDb, createReport, makeUser, reportBody, startDb, stopDb } from './helpers';
import { Emergency } from '../src/models';
import { pointFrom } from '../src/utils/geo';

const rules = { radiusMeters: 500, windowMinutes: 360, similarityThreshold: 0.35 };
const mk = (lat: number, lng: number, type = 'flood', description = 'water level rising near the bridge', createdAt = new Date()) => ({ type, description, location: pointFrom({ lat, lng }), createdAt });

describe('duplicate scoring (unit)', () => {
  it('matches nearby reports of the same type close in time', () => {
    const r = scoreDuplicate(mk(13.0827, 80.2707), mk(13.0829, 80.2709), rules);
    expect(r.isMatch).toBe(true);
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['within_distance', 'same_type']));
  });
  it('does not match distant reports, different types with different words, or reports far apart in time', () => {
    expect(scoreDuplicate(mk(13.0827, 80.2707), mk(13.2, 80.4), rules).isMatch).toBe(false);
    expect(scoreDuplicate(mk(13.0827, 80.2707, 'fire', 'smoke from the factory'), mk(13.0828, 80.2708, 'medical', 'patient needs insulin'), rules).isMatch).toBe(false);
    expect(scoreDuplicate(mk(13.0827, 80.2707), mk(13.0828, 80.2708, 'flood', 'water level rising near the bridge', new Date(Date.now() - 24 * 3600_000)), rules).isMatch).toBe(false);
  });
  it('matches different types when descriptions are very similar (also in Tamil)', () => {
    const a = mk(13.0827, 80.2707, 'flood', 'வீட்டில் தண்ணீர் புகுந்துவிட்டது குழந்தைகள் சிக்கியுள்ளனர்');
    const b = mk(13.0828, 80.2708, 'trapped', 'வீட்டில் தண்ணீர் புகுந்துவிட்டது குழந்தைகள் சிக்கியுள்ளனர்');
    expect(scoreDuplicate(a, b, rules).isMatch).toBe(true);
  });
  it('honours configurable rules', () => {
    const a = mk(13.0827, 80.2707);
    const b = mk(13.0877, 80.2707); // ~550 m
    expect(scoreDuplicate(a, b, rules).isMatch).toBe(false);
    expect(scoreDuplicate(a, b, { ...rules, radiusMeters: 1000 }).isMatch).toBe(true);
  });
});

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe('duplicate detection and review (Feature 5)', () => {
  it('flags possible duplicates for the administrator but never deletes, rejects or merges reports', async () => {
    const a = await makeUser('citizen');
    const b = await makeUser('citizen', 'neighbour');
    const admin = await makeUser('admin');
    const first = await createReport(a);
    const secondRes = await request(api()).post('/api/emergencies').set(b.auth).send(reportBody({ description: 'Flooded street, families need help getting out of the water.' }));
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.meta.duplicateSuspected).toBe(true);
    const second = secondRes.body.data;

    expect(await Emergency.countDocuments()).toBe(2);
    const pairs = await request(api()).get('/api/emergencies/duplicates/pairs').set(admin.auth);
    expect(pairs.status).toBe(200);
    expect(pairs.body.data).toHaveLength(1);
    expect(pairs.body.data[0].reviewStatus).toBe('pending');
    expect(pairs.body.data[0].reasons.length).toBeGreaterThan(0);
    expect([pairs.body.data[0].a.id, pairs.body.data[0].b.id].sort()).toEqual([first.id, second.id].sort());

    // Admin marks as related first, then as confirmed duplicate: both stay available with their history.
    const related = await request(api()).post(`/api/emergencies/${second.id}/duplicates`).set(admin.auth).send({ otherId: first.id, decision: 'related', note: 'same street' });
    expect(related.status).toBe(200);
    const confirmed = await request(api()).post(`/api/emergencies/${second.id}/duplicates`).set(admin.auth).send({ otherId: first.id, decision: 'confirmed_duplicate' });
    expect(confirmed.body.data.a.duplicateOf).toBe(first.id);

    expect(await Emergency.countDocuments()).toBe(2);
    for (const id of [first.id, second.id]) {
      const r = await request(api()).get(`/api/emergencies/${id}`).set(admin.auth);
      expect(r.status).toBe(200);
      expect(r.body.data.status).toBe('pending');
    }
    const reviewed = await request(api()).get('/api/emergencies/duplicates/pairs?status=confirmed_duplicate').set(admin.auth);
    expect(reviewed.body.data).toHaveLength(1);
    const audit = await request(api()).get('/api/admin/audit?action=duplicate.confirmed_duplicate').set(admin.auth);
    expect(audit.body.data).toHaveLength(1);
    // After review nothing is pending any more.
    expect((await request(api()).get('/api/emergencies/duplicates/pairs').set(admin.auth)).body.data).toHaveLength(0);
  });

  it('does not flag unrelated reports', async () => {
    const a = await makeUser('citizen');
    const admin = await makeUser('admin');
    await createReport(a);
    await createReport(a, reportBody({ type: 'medical', description: 'Elderly patient requires dialysis urgently', location: { lat: 12.5, lng: 79.9 } }));
    expect((await request(api()).get('/api/emergencies/duplicates/pairs').set(admin.auth)).body.data).toHaveLength(0);
  });

  it('only administrators can see or review duplicates', async () => {
    const c = await makeUser('citizen');
    const leader = await makeUser('team_leader');
    expect((await request(api()).get('/api/emergencies/duplicates/pairs').set(c.auth)).status).toBe(403);
    const r = await createReport(c);
    expect((await request(api()).post(`/api/emergencies/${r.id}/duplicates`).set(leader.auth).send({ otherId: r.id, decision: 'related' })).status).toBe(403);
  });

  it('rejects reviewing a pair that was never flagged', async () => {
    const a = await makeUser('citizen');
    const admin = await makeUser('admin');
    const x = await createReport(a);
    const y = await createReport(a, reportBody({ type: 'medical', description: 'Completely unrelated far away case', location: { lat: 11.0, lng: 78.0 } }));
    const res = await request(api()).post(`/api/emergencies/${x.id}/duplicates`).set(admin.auth).send({ otherId: y.id, decision: 'related' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DUPLICATE_PAIR_NOT_FOUND');
  });
});
