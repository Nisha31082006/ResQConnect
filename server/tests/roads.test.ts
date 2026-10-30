import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { api, clearDb, makeUser, PNG_BYTES, startDb, stopDb } from './helpers';
import { RoadBlockage, RoadClearanceReport } from '../src/models';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const blockage = (over: Record<string, unknown> = {}) => ({ type: 'flooded', description: 'Knee-deep water, cars are stuck', severity: 'high', location: { lat: 13.08, lng: 80.27, address: 'Underpass' }, ...over });

describe('road blockage reporting and verification (Feature 10)', () => {
  it('creates reports as UNVERIFIED and marks them as such everywhere, including the map', async () => {
    const citizen = await makeUser('citizen');
    const res = await request(api()).post('/api/roads').set(citizen.auth).send(blockage());
    expect(res.status).toBe(201);
    expect(res.body.data.verified).toBe(false);
    expect(res.body.data.verificationStatus).toBe('unverified');
    const map = await request(api()).get('/api/map').set(citizen.auth);
    expect(map.body.data.roads).toHaveLength(1);
    expect(map.body.data.roads[0]).toMatchObject({ verified: false, verificationStatus: 'unverified', status: 'active' });
  });

  it('validates input and accepts an optional photo', async () => {
    const citizen = await makeUser('citizen');
    expect((await request(api()).post('/api/roads').set(citizen.auth).send({ type: 'lava', description: 'x', location: { lat: 99, lng: 0 } })).status).toBe(400);
    const withPhoto = await request(api()).post('/api/roads').set(citizen.auth).field('data', JSON.stringify(blockage())).attach('evidence', PNG_BYTES, { filename: 'road.png', contentType: 'image/png' });
    expect(withPhoto.status).toBe(201);
    expect(withPhoto.body.data.photoUrl).toMatch(/^\/api\/uploads\//);
    const pdf = await request(api()).post('/api/roads').set(citizen.auth).field('data', JSON.stringify(blockage())).attach('evidence', Buffer.from('%PDF-1.4 test'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);
    expect(pdf.body.error.code).toBe('PHOTO_MUST_BE_IMAGE');
  });

  it('lets only administrators verify or reject reports, once', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const r = (await request(api()).post('/api/roads').set(citizen.auth).send(blockage())).body.data;
    expect((await request(api()).post(`/api/roads/${r.id}/verify`).set(citizen.auth).send({ verify: true })).status).toBe(403);
    const v = await request(api()).post(`/api/roads/${r.id}/verify`).set(admin.auth).send({ verify: true, note: 'seen by patrol' });
    expect(v.status).toBe(200);
    expect(v.body.data.verified).toBe(true);
    expect((await request(api()).post(`/api/roads/${r.id}/verify`).set(admin.auth).send({ verify: false })).status).toBe(409);
    const map = await request(api()).get('/api/map').set(citizen.auth);
    expect(map.body.data.roads[0].verified).toBe(true);
  });

  it('hides rejected reports from everyone but admins', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const r = (await request(api()).post('/api/roads').set(citizen.auth).send(blockage())).body.data;
    await request(api()).post(`/api/roads/${r.id}/verify`).set(admin.auth).send({ verify: false, note: 'prank' });
    expect((await request(api()).get('/api/roads').set(citizen.auth)).body.data).toHaveLength(0);
    expect((await request(api()).get('/api/map').set(citizen.auth)).body.data.roads).toHaveLength(0);
    expect((await request(api()).get('/api/roads').set(admin.auth)).body.data).toHaveLength(1);
    expect(await RoadBlockage.countDocuments()).toBe(1); // preserved
  });

  it('keeps a blockage active while a clearance update is pending, and only an admin approval clears it', async () => {
    const citizen = await makeUser('citizen');
    const volunteer = await makeUser('volunteer');
    const admin = await makeUser('admin');
    const r = (await request(api()).post('/api/roads').set(citizen.auth).send(blockage())).body.data;

    expect((await request(api()).post(`/api/roads/${r.id}/clearance`).set(citizen.auth).send({ note: 'I think it is clear now' })).status).toBe(403);
    const sub = await request(api()).post(`/api/roads/${r.id}/clearance`).set(volunteer.auth).send({ note: 'Water drained, road passable' });
    expect(sub.status).toBe(201);
    expect(sub.body.data.status).toBe('pending');
    expect((await RoadBlockage.findById(r.id))?.status).toBe('active'); // unchanged until verified
    const map = await request(api()).get('/api/map').set(citizen.auth);
    expect(map.body.data.roads[0]).toMatchObject({ status: 'active', clearancePending: true });
    expect((await request(api()).post(`/api/roads/${r.id}/clearance`).set(volunteer.auth).send({ note: 'Second attempt' })).body.error.code).toBe('CLEARANCE_PENDING');

    const pending = await request(api()).get('/api/roads/clearances/pending').set(admin.auth);
    expect(pending.body.data).toHaveLength(1);
    expect((await request(api()).post(`/api/roads/clearances/${sub.body.data.id}/decision`).set(volunteer.auth).send({ approve: true })).status).toBe(403);
    expect((await request(api()).post(`/api/roads/clearances/${sub.body.data.id}/decision`).set(admin.auth).send({ approve: false })).status).toBe(400); // reason required

    const rej = await request(api()).post(`/api/roads/clearances/${sub.body.data.id}/decision`).set(admin.auth).send({ approve: false, reason: 'Photo shows water still present' });
    expect(rej.status).toBe(200);
    expect((await RoadBlockage.findById(r.id))?.status).toBe('active');

    const again = await request(api()).post(`/api/roads/${r.id}/clearance`).set(volunteer.auth).send({ note: 'Now it is really clear' });
    expect(again.status).toBe(201);
    const appr = await request(api()).post(`/api/roads/clearances/${again.body.data.id}/decision`).set(admin.auth).send({ approve: true });
    expect(appr.status).toBe(200);
    expect(appr.body.data.status).toBe('cleared');

    // History is preserved: the original blockage and both clearance reports remain.
    expect(await RoadBlockage.countDocuments()).toBe(1);
    expect(await RoadClearanceReport.countDocuments()).toBe(2);
    expect((await request(api()).post(`/api/roads/${r.id}/clearance`).set(volunteer.auth).send({ note: 'Again?' })).body.error.code).toBe('ROAD_ALREADY_CLEARED');
    const detail = await request(api()).get(`/api/roads/${r.id}`).set(admin.auth);
    expect(detail.body.data.clearanceHistory).toHaveLength(2);
  });
});
