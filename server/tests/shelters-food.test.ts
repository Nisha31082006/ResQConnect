import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as H from './helpers';
import { api, clearDb, createSos, makeUser, startDb, stopDb } from './helpers';
import { FoodSupply, Shelter } from '../src/models';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const shelterBody = (over: Record<string, unknown> = {}) => ({
  name: 'Relief Camp A',
  location: { lat: 13.08, lng: 80.27, address: 'Camp road' },
  capacity: 100,
  occupancy: 20,
  facilities: ['water', 'food'],
  contact: { phone: '+914400000000' },
  ...over,
});

describe('shelter capacity validation (Feature 9)', () => {
  it('creates shelters and validates capacity at creation', async () => {
    const admin = await makeUser('admin');
    const ok = await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody());
    expect(ok.status).toBe(201);
    expect(ok.body.data.available).toBe(80);
    const bad = await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody({ occupancy: 101 }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.some((d: { code: string }) => d.code === 'occupancy_exceeds_capacity')).toBe(true);
  });

  it('prevents occupancy from becoming negative or exceeding capacity, and flags full shelters', async () => {
    const admin = await makeUser('admin');
    const coordinator = await makeUser('shelter_coordinator');
    const s = (await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody({ coordinatorId: coordinator.id }))).body.data;
    const set = (body: object) => request(api()).post(`/api/shelters/${s.id}/occupancy`).set(coordinator.auth).send(body);

    expect((await set({ occupancy: 101 })).body.error.code).toBe('OCCUPANCY_EXCEEDS_CAPACITY');
    expect((await set({ delta: 81 })).body.error.code).toBe('OCCUPANCY_EXCEEDS_CAPACITY');
    expect((await set({ delta: -21 })).body.error.code).toBe('OCCUPANCY_NEGATIVE');
    expect((await set({ occupancy: -1 })).status).toBe(400);
    expect((await set({})).status).toBe(400);
    expect((await Shelter.findById(s.id))?.occupancy).toBe(20);

    const up = await set({ delta: 80 });
    expect(up.status).toBe(200);
    expect(up.body.data.occupancy).toBe(100);
    expect(up.body.data.available).toBe(0);
    expect(up.body.data.status).toBe('full');
    const down = await set({ delta: -10 });
    expect(down.body.data.status).toBe('open');
    expect(down.body.data.available).toBe(10);
  });

  it('keeps concurrent updates within capacity (needs atomic single-document updates, as real MongoDB provides)', async (ctx) => {
    if (!H.atomicUpdates) ctx.skip();
    const admin = await makeUser('admin');
    const s = (await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody({ capacity: 10, occupancy: 0 }))).body.data;
    const results = await Promise.all(Array.from({ length: 8 }, () => request(api()).post(`/api/shelters/${s.id}/occupancy`).set(admin.auth).send({ delta: 3 })));
    const okCount = results.filter((r) => r.status === 200).length;
    const stored = await Shelter.findById(s.id);
    expect(stored!.occupancy).toBeLessThanOrEqual(10);
    expect(stored!.occupancy).toBe(okCount * 3);
  });

  it('lets a coordinator manage only their own shelter', async () => {
    const admin = await makeUser('admin');
    const mine = await makeUser('shelter_coordinator', 'mine');
    const other = await makeUser('shelter_coordinator', 'other');
    const s = (await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody({ coordinatorId: mine.id }))).body.data;
    expect((await request(api()).post(`/api/shelters/${s.id}/occupancy`).set(other.auth).send({ delta: 1 })).status).toBe(403);
    expect((await request(api()).patch(`/api/shelters/${s.id}`).set(other.auth).send({ name: 'Taken over' })).status).toBe(403);
    const upd = await request(api()).patch(`/api/shelters/${s.id}`).set(mine.auth).send({ facilities: ['water', 'medical'], accessibilityNotes: 'Ramp at gate' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.facilities).toContain('medical');
    // A coordinator cannot hand the shelter to someone else.
    expect((await request(api()).patch(`/api/shelters/${s.id}`).set(mine.auth).send({ coordinatorId: other.id })).status).toBe(403);
  });

  it('supports admin-approved referrals that reserve space and only change occupancy when the coordinator admits them', async () => {
    const admin = await makeUser('admin');
    const coordinator = await makeUser('shelter_coordinator');
    const citizen = await makeUser('citizen');
    const sos = await createSos(citizen);
    const s = (await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody({ capacity: 30, occupancy: 20, coordinatorId: coordinator.id }))).body.data;
    expect((await request(api()).post(`/api/shelters/${s.id}/referrals`).set(coordinator.auth).send({ people: 2 })).status).toBe(403);
    const ref = await request(api()).post(`/api/shelters/${s.id}/referrals`).set(admin.auth).send({ people: 6, emergencyId: sos.id });
    expect(ref.status).toBe(201);
    expect((await Shelter.findById(s.id))?.occupancy).toBe(20);
    // Reserved places count against capacity.
    const tooMany = await request(api()).post(`/api/shelters/${s.id}/referrals`).set(admin.auth).send({ people: 5 });
    expect(tooMany.body.error.code).toBe('SHELTER_CAPACITY_INSUFFICIENT');
    const admit = await request(api()).post(`/api/shelters/${s.id}/referrals/${ref.body.data.id}/admit`).set(coordinator.auth);
    expect(admit.status).toBe(200);
    expect(admit.body.data.occupancy).toBe(26);
    expect((await request(api()).post(`/api/shelters/${s.id}/referrals/${ref.body.data.id}/admit`).set(coordinator.auth)).status).toBe(409);
  });

  it('hides the coordinator identity from non-admins and lists shelters for everyone signed in', async () => {
    const admin = await makeUser('admin');
    const citizen = await makeUser('citizen');
    await request(api()).post('/api/shelters').set(admin.auth).send(shelterBody());
    const list = await request(api()).get('/api/shelters?availableOnly=true').set(citizen.auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body.data[0])).not.toMatch(/coordinator/i);
  });
});

async function foodSetup() {
  const admin = await makeUser('admin');
  const owner = await makeUser('food_provider');
  const citizen = await makeUser('citizen');
  const provider = await request(api()).post('/api/food/providers').set(owner.auth).send({ name: 'Community Kitchen', location: { lat: 13.07, lng: 80.26 }, operatingHours: '8am-8pm', contact: { phone: '+919800000010' } });
  expect(provider.status).toBe(201);
  const supply = await request(api()).post('/api/food/supplies').set(owner.auth).send({ foodType: 'Rice meals', unit: 'meals', quantityTotal: 100 });
  expect(supply.status).toBe(201);
  return { admin, owner, citizen, provider: provider.body.data, supply: supply.body.data };
}
const requestFood = (u: { auth: Record<string, string> }, qty: number, over: Record<string, unknown> = {}) =>
  request(api()).post('/api/food/requests').set(u.auth).send({ community: 'Riverside colony', quantityRequested: qty, unit: 'meals', ...over });

describe('food allocation validation (Feature 8)', () => {
  it('registers a provider profile and tracks remaining availability', async () => {
    const { owner, supply } = await foodSetup();
    expect(supply.quantityAvailable).toBe(100);
    const mine = await request(api()).get('/api/food/providers/me').set(owner.auth);
    expect(mine.body.data.name).toBe('Community Kitchen');
    expect((await request(api()).post('/api/food/providers').set(owner.auth).send({ name: 'Second', location: { lat: 13, lng: 80 }, operatingHours: '9-5' })).status).toBe(409);
  });

  it('requires admin review and never lets approvals exceed what is available', async () => {
    const { admin, citizen, supply } = await foodSetup();
    const r1 = (await requestFood(citizen, 70)).body.data;
    const r2 = (await requestFood(citizen, 50)).body.data;
    expect(r1.status).toBe('requested');
    expect((await request(api()).post(`/api/food/allocations/${r1.id}/approve`).set(citizen.auth).send({ supplyId: supply.id, quantity: 70 })).status).toBe(403);

    const ok = await request(api()).post(`/api/food/allocations/${r1.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 70 });
    expect(ok.status).toBe(200);
    expect((await FoodSupply.findById(supply.id))?.quantityAvailable).toBe(30);

    const over = await request(api()).post(`/api/food/allocations/${r2.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 50 });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('FOOD_OVER_ALLOCATION');
    expect((await FoodSupply.findById(supply.id))?.quantityAvailable).toBe(30);

    const exceedsRequest = await request(api()).post(`/api/food/allocations/${r2.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 51 });
    expect(exceedsRequest.body.error.code).toBe('QUANTITY_EXCEEDS_REQUEST');
    const partial = await request(api()).post(`/api/food/allocations/${r2.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 30 });
    expect(partial.status).toBe(200);
    expect((await FoodSupply.findById(supply.id))?.quantityAvailable).toBe(0);
  });

  it('handles concurrent approvals without over-allocating (needs atomic single-document updates, as real MongoDB provides)', async (ctx) => {
    if (!H.atomicUpdates) ctx.skip();
    const { admin, citizen, supply } = await foodSetup();
    const reqs = await Promise.all(Array.from({ length: 5 }, () => requestFood(citizen, 40)));
    const results = await Promise.all(reqs.map((r) => request(api()).post(`/api/food/allocations/${r.body.data.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 40 })));
    const approved = results.filter((r) => r.status === 200).length;
    expect(approved).toBeLessThanOrEqual(2);
    const left = (await FoodSupply.findById(supply.id))!.quantityAvailable;
    expect(left).toBe(100 - approved * 40);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it('tracks delivery, returns unused food to the supply and reports quantity supplied', async () => {
    const { admin, owner, citizen, supply } = await foodSetup();
    const r = (await requestFood(citizen, 60)).body.data;
    await request(api()).post(`/api/food/allocations/${r.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 60 });
    expect((await request(api()).post(`/api/food/allocations/${r.id}/status`).set(owner.auth).send({ status: 'delivered' })).status).toBe(409); // must be dispatched first
    expect((await request(api()).post(`/api/food/allocations/${r.id}/status`).set(owner.auth).send({ status: 'dispatched' })).status).toBe(200);
    expect((await request(api()).post(`/api/food/allocations/${r.id}/status`).set(owner.auth).send({ status: 'delivered', quantitySupplied: 61 })).body.error.code).toBe('SUPPLIED_EXCEEDS_APPROVED');
    const done = await request(api()).post(`/api/food/allocations/${r.id}/status`).set(owner.auth).send({ status: 'delivered', quantitySupplied: 50 });
    expect(done.status).toBe(200);
    expect(done.body.data.quantitySupplied).toBe(50);
    expect((await FoodSupply.findById(supply.id))?.quantityAvailable).toBe(50); // 100 - 60 + 10 unused
    // Someone else's provider cannot touch it.
    const stranger = await makeUser('food_provider', 'stranger');
    expect((await request(api()).post(`/api/food/allocations/${r.id}/status`).set(stranger.auth).send({ status: 'cancelled' })).status).toBe(403);
  });

  it('restores quantity when an approved allocation is cancelled and validates requests', async () => {
    const { admin, citizen, supply } = await foodSetup();
    const r = (await requestFood(citizen, 25)).body.data;
    await request(api()).post(`/api/food/allocations/${r.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 25 });
    await request(api()).post(`/api/food/allocations/${r.id}/status`).set(admin.auth).send({ status: 'cancelled' });
    expect((await FoodSupply.findById(supply.id))?.quantityAvailable).toBe(100);
    expect((await requestFood(citizen, 0)).status).toBe(400);
    expect((await request(api()).post('/api/food/requests').set(citizen.auth).send({ quantityRequested: 5 })).status).toBe(400); // needs an emergency or community
  });

  it('only shows providers their own allocations and the supply of other providers stays private', async () => {
    const { admin, owner, citizen, supply } = await foodSetup();
    const stranger = await makeUser('food_provider', 'stranger');
    await request(api()).post('/api/food/providers').set(stranger.auth).send({ name: 'Other Kitchen', location: { lat: 13, lng: 80 }, operatingHours: '9-5' });
    const r = (await requestFood(citizen, 10)).body.data;
    await request(api()).post(`/api/food/allocations/${r.id}/approve`).set(admin.auth).send({ supplyId: supply.id, quantity: 10 });
    expect((await request(api()).get('/api/food/allocations').set(owner.auth)).body.data).toHaveLength(1);
    expect((await request(api()).get('/api/food/allocations').set(stranger.auth)).body.data).toHaveLength(0);
    expect((await request(api()).patch(`/api/food/supplies/${supply.id}`).set(stranger.auth).send({ quantityTotal: 5 })).status).toBe(403);
  });
});
