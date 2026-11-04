import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { clusterReports, zoneRisk, type ZonePoint } from '../src/services/automation/zones';
import { shortageOf, shortageSeverity } from '../src/services/automation/resources';
import { loadState } from '../src/services/automation/workload';
import { pickFormation, scoreVolunteer } from '../src/services/automation/teamFormation';
import { neededFacilities, scoreShelter } from '../src/services/automation/shelters';
import { recommendPriority } from '../src/services/priority.service';
import { defaultAutomation, defaultPriorityConfig } from '../src/services/settings.service';
import { runAutomation } from '../src/services/automation/runner';
import { api, CHENNAI, clearDb, createReport, createSos, makeUser, reportBody, sosBody, startDb, stopDb } from './helpers';
import { Assignment, Emergency, EmergencyZone, FollowUp, FoodProvider, FoodSupply, Notification, ResourceAlert, Shelter, ShelterReferral } from '../src/models';

const cfg = defaultAutomation();
const pt = (id: string, dLat: number, minsAgo: number, type = 'flood', people = 2, kind: 'normal' | 'sos' = 'normal'): ZonePoint => ({
  id,
  at: new Date(Date.now() - minsAgo * 60000),
  type,
  people,
  kind,
  ll: { lat: CHENNAI.lat + dLat, lng: CHENNAI.lng },
});

describe('automation rules (unit)', () => {
  it('clusters nearby reports within the time window and ignores far or old ones', () => {
    const near = [pt('a', 0, 10), pt('b', 0.002, 20), pt('c', 0.004, 30)]; // ~220 m apart
    const far = pt('far', 0.5, 10);
    const old = pt('old', 0.001, 600);
    const groups = clusterReports([...near, far, old], cfg.zones);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('needs the minimum number of reports and can require the same type', () => {
    expect(clusterReports([pt('a', 0, 5), pt('b', 0.001, 5)], cfg.zones)).toHaveLength(0);
    const mixed = [pt('a', 0, 5, 'flood'), pt('b', 0.001, 5, 'fire'), pt('c', 0.002, 5, 'flood')];
    expect(clusterReports(mixed, cfg.zones)).toHaveLength(1);
    expect(clusterReports(mixed, { ...cfg.zones, sameTypeOnly: true })).toHaveLength(0);
  });
  it('rates zone risk transparently', () => {
    expect(zoneRisk(3, 6, 0)).toBe('medium');
    expect(zoneRisk(5, 6, 0)).toBe('high');
    expect(zoneRisk(3, 6, 1)).toBe('high');
    expect(zoneRisk(3, 6, 2)).toBe('critical');
    expect(zoneRisk(3, 100, 0)).toBe('critical');
  });
  it('computes shortage as required minus available (200 / 120 -> 80)', () => {
    expect(shortageOf(200, 120)).toBe(80);
    expect(shortageOf(100, 150)).toBe(0);
    expect(shortageSeverity(200, 120)).toBe('warning');
    expect(shortageSeverity(200, 60)).toBe('critical');
  });
  it('classifies volunteer workload', () => {
    expect(loadState(0, 'available', 3)).toBe('available');
    expect(loadState(2, 'available', 3)).toBe('busy');
    expect(loadState(3, 'available', 3)).toBe('overloaded');
    expect(loadState(0, 'unavailable', 3)).toBe('unavailable');
  });
  it('scores volunteers by skills, availability, workload and distance', () => {
    const best = scoreVolunteer({ skills: ['boat'], availability: 'available', activeTasks: 0 }, ['boat'], 2, cfg);
    const farBusy = scoreVolunteer({ skills: [], availability: 'busy', activeTasks: 2 }, ['boat'], 45, cfg);
    expect(best.score).toBeGreaterThan(farBusy.score);
    expect(best.score).toBeLessThanOrEqual(100);
    expect(best.reasons.map((r) => r.code)).toContain('distance');
    expect(scoreVolunteer({ skills: [], availability: 'available', activeTasks: 0 }, [], null, cfg).reasons.map((r) => r.code)).toContain('location_unknown');
  });
  it('picks a formation that covers required skills first', () => {
    const ranked = [
      { id: 'a', skills: ['rescue'], score: 90 },
      { id: 'b', skills: ['rescue'], score: 80 },
      { id: 'c', skills: ['medical'], score: 50 },
    ];
    const r = pickFormation(ranked, 2, ['rescue', 'medical']);
    expect(r.chosen.map((c) => c.id)).toEqual(['a', 'c']);
    expect(r.missingSkills).toEqual([]);
    expect(pickFormation(ranked, 1, ['boat']).missingSkills).toEqual(['boat']);
  });
  it('maps needs to shelter facilities and prefers near shelters with matching facilities', () => {
    expect(neededFacilities({ assistanceNeeds: ['food', 'medical_aid', 'blankets'], vulnerable: { disabled: true, children: false, elderly: false, pregnant: false, injured: false }, type: 'flood' }).sort()).toEqual(['bedding', 'food', 'medical', 'wheelchair_access']);
    const near = scoreShelter({ distanceKm: 1, maxDistanceKm: 30, free: 50, people: 10, needed: ['food'], facilities: ['food'] });
    const far = scoreShelter({ distanceKm: 25, maxDistanceKm: 30, free: 50, people: 10, needed: ['food'], facilities: [] });
    expect(near.score).toBeGreaterThan(far.score);
  });
  it('adds trapped-person and medical-need points to the system priority', () => {
    const base = { kind: 'normal' as const, dangerToLife: false, affectedCount: 4, severity: 'medium' as const, status: 'pending' as const };
    const plain = recommendPriority(base, defaultPriorityConfig, 300);
    const rich = recommendPriority({ ...base, trappedCount: 4, assistanceNeeds: ['medical_aid'] }, defaultPriorityConfig, 300);
    expect(rich.score).toBe(plain.score + 10 + 8);
    expect(rich.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['trapped_persons', 'medical_assistance']));
  });
});

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const oid = (id: string) => new Types.ObjectId(id);
const backdate = (id: string, minutes: number) => Emergency.collection.updateOne({ _id: oid(id) }, { $set: { createdAt: new Date(Date.now() - minutes * 60000), 'statusHistory.0.at': new Date(Date.now() - minutes * 60000) } });

async function world() {
  const admin = await makeUser('admin');
  const citizen = await makeUser('citizen');
  return { admin, citizen };
}

describe('automation access control', () => {
  const paths = ['/overview', '/team-recommendations', '/team-gaps', '/zones', '/resource-alerts', '/shelter-recommendations', '/workload', '/sos', '/follow-ups'];
  it('requires authentication and the admin role for every automation endpoint', async () => {
    const roles = await Promise.all((['citizen', 'volunteer', 'team_leader', 'food_provider', 'shelter_coordinator'] as const).map((r) => makeUser(r)));
    const admin = await makeUser('admin');
    for (const p of paths) {
      expect((await request(api()).get(`/api/automation${p}`)).status).toBe(401);
      for (const u of roles) expect((await request(api()).get(`/api/automation${p}`).set(u.auth)).status).toBe(403);
      expect((await request(api()).get(`/api/automation${p}`).set(admin.auth)).status).toBe(200);
    }
    expect((await request(api()).post('/api/automation/run').set(roles[0].auth)).status).toBe(403);
    expect((await request(api()).post('/api/automation/team-formation/approve').set(roles[1].auth).send({})).status).toBe(403);
  });
});

describe('Smart priority recommendation (Feature 5)', () => {
  it('keeps the citizen-selected priority separate from the system recommendation and lets the admin decide', async () => {
    const { admin, citizen } = await world();
    const rep = await createReport(citizen, reportBody({ citizenPriority: 'low', affectedCount: 12, trappedCount: 6, severity: 'severe', dangerToLife: true, assistanceNeeds: ['medical_aid'] }));
    const view = await request(api()).get(`/api/emergencies/${rep.id}`).set(admin.auth);
    expect(view.body.data.citizenPriority).toBe('low');
    expect(view.body.data.trappedCount).toBe(6);
    expect(view.body.data.recommendedPriority.level).toBe('critical');
    const codes = view.body.data.recommendedPriority.reasons.map((r: { code: string }) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['trapped_persons', 'medical_assistance', 'danger_to_life']));
    const list = await request(api()).get('/api/emergencies?priority=critical').set(admin.auth);
    expect(list.body.data.map((e: { id: string }) => e.id)).toContain(rep.id); // ordered by system priority, not citizen choice
    const decide = await request(api()).post(`/api/emergencies/${rep.id}/priority`).set(admin.auth).send({ level: 'high', overrideReason: 'Road access limited, handled by nearby team' });
    expect(decide.status).toBeLessThan(300);
    const after = await request(api()).get(`/api/emergencies/${rep.id}`).set(admin.auth);
    expect(after.body.data.finalPriority.level).toBe('high');
    expect(after.body.data.citizenPriority).toBe('low');
  });
  it('validates the new fields', async () => {
    const { citizen } = await world();
    const bad = await request(api()).post('/api/emergencies').set(citizen.auth).send(reportBody({ citizenPriority: 'urgent' }));
    expect(bad.status).toBe(400);
    const neg = await request(api()).post('/api/emergencies').set(citizen.auth).send(reportBody({ trappedCount: -1 }));
    expect(neg.status).toBe(400);
    const sos = await request(api()).post('/api/sos').set(citizen.auth).send(sosBody({ citizenPriority: 'critical', trappedCount: 2 }));
    expect(sos.status).toBe(201);
    expect(sos.body.data.citizenPriority).toBe('critical');
  });
});

describe('Smart emergency zone detection (Feature 3)', () => {
  it('groups nearby reports into a zone, never touches the reports, and does not duplicate on re-run', async () => {
    const { admin, citizen } = await world();
    const c2 = await makeUser('citizen', 'c2');
    const ids: string[] = [];
    for (const [u, d] of [[citizen, 0], [c2, 0.001], [citizen, 0.002]] as const) {
      ids.push((await createReport(u, reportBody({ location: { lat: CHENNAI.lat + d, lng: CHENNAI.lng, address: 'Anna Nagar' }, affectedCount: 5, description: `Flooding near block ${d} needs rescue boats` }))).id);
    }
    const far = await createReport(citizen, reportBody({ location: { lat: CHENNAI.lat + 0.4, lng: CHENNAI.lng }, description: 'A distant different flooding report' }));
    const run1 = await runAutomation();
    expect(run1.errors).toEqual([]);
    expect(run1.zones?.created).toBe(1);
    const run2 = await runAutomation();
    expect(run2.zones?.created).toBe(0);
    expect(await EmergencyZone.countDocuments({})).toBe(1);
    expect(await Emergency.countDocuments({})).toBe(4); // nothing merged or deleted

    const zones = (await request(api()).get('/api/automation/zones').set(admin.auth)).body.data;
    expect(zones).toHaveLength(1);
    expect(zones[0].reportCount).toBe(3);
    expect(zones[0].peopleCount).toBe(15);
    expect(zones[0].emergencyIds.sort()).toEqual([...ids].sort());
    expect(zones[0].emergencyIds).not.toContain(far.id);
    const detail = await request(api()).get(`/api/automation/zones/${zones[0].id}`).set(admin.auth);
    expect(detail.body.data.emergencies).toHaveLength(3);
    expect(await Notification.countDocuments({ user: admin.user._id, type: 'zone_detected' })).toBe(1);

    const map = await request(api()).get('/api/map').set(admin.auth);
    expect(map.body.data.zones).toHaveLength(1);
    expect((await request(api()).get('/api/map').set(citizen.auth)).body.data.zones).toEqual([]);

    const review = await request(api()).post(`/api/automation/zones/${zones[0].id}/review`).set(admin.auth).send({ decision: 'reviewed', note: 'Confirmed on call' });
    expect(review.body.data.status).toBe('reviewed');
    expect((await request(api()).post(`/api/automation/zones/${zones[0].id}/review`).set(admin.auth).send({ decision: 'nope' })).status).toBe(400);
  });
});

describe('Automatic resource shortage detection (Feature 2)', () => {
  it('computes required vs available from real data, alerts once and resolves when supply arrives', async () => {
    const { admin, citizen } = await world();
    const provider = await makeUser('food_provider');
    const pr = await new FoodProvider({ name: 'Community Kitchen', owner: provider.user._id, location: { type: 'Point', coordinates: [CHENNAI.lng, CHENNAI.lat] }, status: 'active', address: 'Kitchen road' } as never).save();
    await FoodSupply.create({ provider: pr._id, foodType: 'Meals', unit: 'meals', quantityTotal: 120, quantityAvailable: 120, active: true });
    await request(api()).put('/api/admin/settings').set(admin.auth).send({ automation: { food: { mealsPerPersonPerDay: 2, days: 1 } } }).expect(200);
    await createReport(citizen, reportBody({ affectedCount: 100, assistanceNeeds: ['food'], description: 'Hundred people stranded without any food' }));

    const r1 = await runAutomation();
    expect(r1.resources?.created).toBe(1);
    expect((await runAutomation()).resources?.created).toBe(0); // no duplicate alert
    const list = (await request(api()).get('/api/automation/resource-alerts').set(admin.auth)).body.data;
    const food = list.alerts.find((a: { kind: string }) => a.kind === 'food_shortage');
    expect(food).toMatchObject({ required: 200, available: 120, shortage: 80, status: 'open' });
    expect(food.locations[0].people).toBe(100);
    expect(list.snapshot.food.shortage).toBe(80);
    expect(await Notification.countDocuments({ user: admin.user._id, type: 'resource_shortage' })).toBe(1);

    await FoodSupply.updateMany({}, { quantityAvailable: 400, quantityTotal: 400 });
    const r3 = await runAutomation();
    expect(r3.resources?.resolved).toBe(1);
    expect((await ResourceAlert.findOne({ key: 'food:all' }))?.status).toBe('resolved');
  });
  it('raises shelter shortage and near-capacity alerts', async () => {
    const { admin, citizen } = await world();
    await Shelter.create({ name: 'School Hall', location: { type: 'Point', coordinates: [CHENNAI.lng, CHENNAI.lat] }, capacity: 50, occupancy: 48, status: 'open', facilities: [], createdBy: admin.user._id });
    await createReport(citizen, reportBody({ affectedCount: 30, assistanceNeeds: ['shelter'], description: 'Thirty people lost their homes and need shelter' }));
    await runAutomation();
    const alerts = (await request(api()).get('/api/automation/resource-alerts').set(admin.auth)).body.data.alerts;
    expect(alerts.find((a: { kind: string }) => a.kind === 'shelter_shortage')).toMatchObject({ required: 30, available: 2, shortage: 28 });
    expect(alerts.find((a: { kind: string }) => a.kind === 'shelter_near_capacity')?.locations[0].name).toBe('School Hall');
    const ack = await request(api()).post(`/api/automation/resource-alerts/${alerts[0].id}/acknowledge`).set(admin.auth);
    expect(ack.status).toBe(200);
  });
});

describe('Smart shelter recommendation (Feature 4)', () => {
  it('recommends only shelters with enough free places, and confirmation reserves places without registering anyone', async () => {
    const { admin, citizen } = await world();
    const loc = (dLat: number) => ({ type: 'Point' as const, coordinates: [CHENNAI.lng, CHENNAI.lat + dLat] });
    const nearFull = await Shelter.create({ name: 'Nearly Full', location: loc(0.001), capacity: 20, occupancy: 18, status: 'open', facilities: ['food'], createdBy: admin.user._id });
    const good = await Shelter.create({ name: 'Good Hall', location: loc(0.02), capacity: 100, occupancy: 10, status: 'open', facilities: ['food', 'medical'], createdBy: admin.user._id });
    const farther = await Shelter.create({ name: 'Plain Hall', location: loc(0.05), capacity: 100, occupancy: 10, status: 'open', facilities: [], createdBy: admin.user._id });
    await Shelter.create({ name: 'Closed', location: loc(0.002), capacity: 100, occupancy: 0, status: 'closed', facilities: [], createdBy: admin.user._id });
    const rep = await createReport(citizen, reportBody({ affectedCount: 12, assistanceNeeds: ['shelter', 'food', 'medical_aid'], description: 'Twelve people need shelter and medical help' }));

    const rec = (await request(api()).get(`/api/automation/emergencies/${rep.id}/shelter-recommendation`).set(admin.auth)).body.data;
    expect(rec.shelters.map((s: { name: string }) => s.name)).toEqual(['Good Hall', 'Plain Hall']);
    expect(rec.excluded.insufficientCapacity).toBe(1);
    expect(rec.shelters[0]).toMatchObject({ availableSpaces: 90, matchedFacilities: ['food', 'medical'] });
    expect(rec.shelters[0].distanceKm).toBeGreaterThan(2);

    const bad = await request(api()).post(`/api/automation/emergencies/${rep.id}/shelter/confirm`).set(admin.auth).send({ shelterId: String(nearFull._id) });
    expect(bad.status).toBe(400);
    const ok = await request(api()).post(`/api/automation/emergencies/${rep.id}/shelter/confirm`).set(admin.auth).send({ shelterId: String(good._id) });
    expect(ok.status).toBe(201);
    expect((await Shelter.findById(good._id))?.occupancy).toBe(10); // nobody registered automatically
    expect(await ShelterReferral.countDocuments({ shelter: good._id, status: 'referred', people: 12 })).toBe(1);
    expect((await request(api()).post(`/api/automation/emergencies/${rep.id}/shelter/confirm`).set(admin.auth).send({ shelterId: String(farther._id) })).status).toBe(409);
    const again = (await request(api()).get(`/api/automation/emergencies/${rep.id}/shelter-recommendation`).set(admin.auth)).body.data;
    expect(again.planned.shelter).toBe(String(good._id));
  });
});

describe('Smart rescue team formation and workload (Features 1 and 7)', () => {
  async function crew() {
    const { admin, citizen } = await world();
    const home = (dLat: number) => ({ homeLocation: { type: 'Point', coordinates: [CHENNAI.lng, CHENNAI.lat + dLat] } });
    const medic = await makeUser('volunteer', 'medic', { skills: ['medical'], ...home(0.01) });
    const boater = await makeUser('volunteer', 'boater', { skills: ['boat', 'rescue'], ...home(0.02) });
    const farBoater = await makeUser('volunteer', 'farboater', { skills: ['boat'], ...home(0.9) });
    const resting = await makeUser('volunteer', 'resting', { skills: ['boat'], availability: 'unavailable' });
    return { admin, citizen, medic, boater, farBoater, resting };
  }
  it('recommends by skills, availability, workload and distance, never dispatches, and needs admin approval', async () => {
    const c = await crew();
    const rep = await createReport(c.citizen, reportBody({ affectedCount: 8, description: 'Eight people on a rooftop need a boat and medical help' }));
    await request(api()).post(`/api/emergencies/${rep.id}/status`).set(c.admin.auth).send({ to: 'acknowledged' }).expect(200);
    await request(api()).put(`/api/emergencies/${rep.id}/requirements`).set(c.admin.auth).send({ requiredVolunteers: 2, requiredSkills: ['boat', 'medical'] }).expect(200);

    const rec = (await request(api()).get(`/api/automation/emergencies/${rep.id}/team-recommendation`).set(c.admin.auth)).body.data;
    const names = rec.volunteers.map((v: { name: string }) => v.name);
    expect(names).not.toContain('resting'); // unavailable volunteers excluded
    expect(names.indexOf('boater')).toBeLessThan(names.indexOf('farboater'));
    expect(rec.volunteers[0].reasons.length).toBeGreaterThan(2);
    expect(rec.proposedFormation.size).toBe(2);
    expect(rec.proposedFormation.missingSkills).toEqual([]);
    expect(rec.staffing.gap).toBe(2);
    expect(await Assignment.countDocuments({})).toBe(0); // advisory only

    const noPriority = await request(api()).post('/api/automation/team-formation/approve').set(c.admin.auth).send({ emergencyId: rep.id, volunteerIds: rec.proposedFormation.volunteerIds });
    expect(noPriority.status).toBe(409);
    expect(noPriority.body.error.code).toBe('PRIORITY_NOT_CONFIRMED');
    await request(api()).post(`/api/emergencies/${rep.id}/priority`).set(c.admin.auth).send({ level: 'high', overrideReason: 'Admin review of the situation' }).expect(200);

    const approved = await request(api()).post('/api/automation/team-formation/approve').set(c.admin.auth).send({ emergencyId: rep.id, volunteerIds: rec.proposedFormation.volunteerIds, instructions: 'Go by boat' });
    expect(approved.status).toBe(201);
    expect(await Assignment.countDocuments({ status: 'active' })).toBe(1);
    expect(await Notification.countDocuments({ user: c.boater.user._id, type: 'assignment_created' })).toBe(1);
    const overview = (await request(api()).get('/api/automation/overview').set(c.admin.auth)).body.data;
    expect(overview.summary.emergenciesNeedingTeams).toBe(0);
  });
  it('identifies overloaded volunteers, recommends alternatives, and reassigns nothing', async () => {
    const c = await crew();
    const sosIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const e = await createSos(c.citizen, sosBody({ description: `Distinct emergency number ${i} needing boat rescue` }));
      await request(api()).post(`/api/emergencies/${e.id}/status`).set(c.admin.auth).send({ to: 'acknowledged' }).expect(200);
      await request(api()).post(`/api/emergencies/${e.id}/priority`).set(c.admin.auth).send({ level: 'critical', overrideReason: 'Admin review of the situation' }).expect(200);
      await request(api()).post('/api/assignments').set(c.admin.auth).send({ emergencyId: e.id, volunteerIds: [String(c.boater.id)] }).expect(201);
      sosIds.push(e.id);
    }
    const before = await Assignment.find({}).lean();
    const w = (await request(api()).get('/api/automation/workload?state=overloaded').set(c.admin.auth)).body.data;
    expect(w.volunteers).toHaveLength(1);
    expect(w.volunteers[0]).toMatchObject({ name: 'boater', activeTasks: 3, state: 'overloaded' });
    expect(w.volunteers[0].alternatives[0].name).toBe('farboater'); // shares the "boat" skill, no workload
    const all = (await request(api()).get('/api/automation/workload').set(c.admin.auth)).body.data;
    expect(all.summary).toMatchObject({ overloaded: 1, available: 2, unavailable: 1 });
    expect(await Assignment.find({}).lean()).toEqual(before);
  });
  it('lets volunteers share a location and validates it', async () => {
    const { admin } = await world();
    const v = await makeUser('volunteer', 'locvol');
    expect((await request(api()).put('/api/users/me/location').set(v.auth).send({ lat: 13.1, lng: 80.2 })).status).toBe(200);
    expect((await request(api()).put('/api/users/me/location').set(v.auth).send({ lat: 913, lng: 80.2 })).status).toBe(400);
    expect((await request(api()).put('/api/users/me/location').set(admin.auth).send({ lat: 13.1, lng: 80.2 })).status).toBe(403);
    expect((await request(api()).get('/api/users/me/location').set(v.auth)).body.data.lat).toBe(13.1);
  });
});

describe('Automatic emergency follow-up (Feature 8)', () => {
  it('reminds about idle emergencies, idle rescue progress and stale shelters, without duplicates, and closes when updated', async () => {
    const { admin, citizen } = await world();
    const leader = await makeUser('team_leader', 'lead');
    const coord = await makeUser('shelter_coordinator');
    const team = (await request(api()).post('/api/teams').set(admin.auth).send({ name: 'Alpha', leaderId: leader.id, memberIds: [], skills: [], capacity: 3 })).body.data;
    const shelter = await Shelter.create({ name: 'Relief Camp', location: { type: 'Point', coordinates: [CHENNAI.lng, CHENNAI.lat] }, capacity: 40, occupancy: 5, status: 'open', facilities: [], coordinator: coord.user._id, createdBy: admin.user._id });
    await Shelter.collection.updateOne({ _id: shelter._id }, { $set: { createdAt: new Date(Date.now() - 24 * 3600000) } });

    const idle = await createReport(citizen, reportBody({ description: 'Nobody has looked at this report for a long while' }));
    await backdate(idle.id, 90);
    const rescue = await createReport(citizen, reportBody({ location: { lat: CHENNAI.lat + 0.3, lng: CHENNAI.lng }, description: 'Active rescue that has no progress notes yet' }));
    await request(api()).post(`/api/emergencies/${rescue.id}/status`).set(admin.auth).send({ to: 'acknowledged' }).expect(200);
    await request(api()).post(`/api/emergencies/${rescue.id}/priority`).set(admin.auth).send({ level: 'high', overrideReason: 'Admin review of the situation' }).expect(200);
    await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: rescue.id, teamId: team.id }).expect(201);
    await Assignment.collection.updateOne({ emergency: oid(rescue.id) }, { $set: { assignedAt: new Date(Date.now() - 3 * 3600000) } });
    const raw = (await Emergency.collection.findOne({ _id: oid(rescue.id) })) as unknown as { statusHistory: { at: Date }[] };
    await Emergency.collection.updateOne({ _id: oid(rescue.id) }, { $set: { statusHistory: raw.statusHistory.map((h) => ({ ...h, at: new Date(Date.now() - 3 * 3600000) })) } });

    const r1 = await runAutomation();
    expect(r1.errors).toEqual([]);
    expect(r1.followUps?.created).toBe(3);
    expect((await runAutomation()).followUps?.created).toBe(0);
    expect(await FollowUp.countDocuments({ status: 'open' })).toBe(3);
    expect(await Notification.countDocuments({ user: leader.user._id, type: 'followup_rescue_progress' })).toBe(1);
    expect(await Notification.countDocuments({ user: coord.user._id, type: 'followup_shelter_occupancy' })).toBe(1);
    expect(await Notification.countDocuments({ user: admin.user._id, type: 'followup_emergency_update' })).toBe(1);
    const rows = (await request(api()).get('/api/automation/follow-ups').set(admin.auth)).body.data;
    expect(rows.map((r: { kind: string }) => r.kind).sort()).toEqual(['emergency_update', 'rescue_progress', 'shelter_occupancy']);
    expect(rows.find((r: { kind: string }) => r.kind === 'rescue_progress').assignees).toEqual(['lead']);

    // The team leader posts progress and the coordinator refreshes occupancy: both follow-ups close on the next pass.
    const asg = await Assignment.findOne({ emergency: rescue.id });
    await request(api()).post(`/api/assignments/${asg!._id}/progress`).set(leader.auth).send({ note: 'Reached the area', percent: 20 }).expect(200);
    await request(api()).post(`/api/shelters/${shelter._id}/occupancy`).set(coord.auth).send({ occupancy: 12 }).expect(200);
    const r3 = await runAutomation();
    expect(r3.followUps?.completed).toBe(2);
    expect(await FollowUp.countDocuments({ status: 'open' })).toBe(1);

    const open = rows.find((r: { kind: string }) => r.kind === 'emergency_update');
    expect((await request(api()).post(`/api/automation/follow-ups/${open.id}/remind`).set(admin.auth)).body.data.reminderCount).toBe(2);
    await request(api()).post(`/api/automation/follow-ups/${open.id}/dismiss`).set(admin.auth).expect(200);
    expect((await runAutomation()).followUps?.created).toBe(0); // dismissal pauses re-creation
    expect((await request(api()).post(`/api/automation/follow-ups/${open.id}/dismiss`).set(admin.auth)).status).toBe(404);
  });
});

describe('Automatic SOS escalation on the automation dashboard (Feature 6)', () => {
  it('lists unacknowledged SOS, stops after acknowledgement, and never duplicates alerts', async () => {
    const { admin, citizen } = await world();
    const sos = await createSos(citizen);
    await backdate(sos.id, 20);
    await runAutomation();
    await runAutomation();
    expect(await Notification.countDocuments({ user: admin.user._id, type: 'sos_escalated' })).toBeGreaterThan(0);
    const before = await Notification.countDocuments({ user: admin.user._id, type: 'sos_escalated' });
    await runAutomation();
    expect(await Notification.countDocuments({ user: admin.user._id, type: 'sos_escalated' })).toBe(before);
    const s = (await request(api()).get('/api/automation/sos').set(admin.auth)).body.data;
    expect(s.items[0]).toMatchObject({ overdue: true, escalationLevel: expect.any(Number) });
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' }).expect(200);
    expect((await request(api()).get('/api/automation/sos').set(admin.auth)).body.data.items).toHaveLength(0);
    await runAutomation();
    expect(await Notification.countDocuments({ user: admin.user._id, type: 'sos_escalated' })).toBe(before);
  });
});

describe('manual run and settings', () => {
  it('runs all checks on demand and persists configurable thresholds with validation', async () => {
    const { admin } = await world();
    const run = await request(api()).post('/api/automation/run').set(admin.auth);
    expect(run.status).toBe(200);
    expect(run.body.data.errors).toEqual([]);
    const set = await request(api()).put('/api/admin/settings').set(admin.auth).send({ automation: { zones: { radiusMeters: 250, minReports: 2 }, workload: { overloadedAt: 5 } } });
    expect(set.status).toBe(200);
    expect(set.body.data.automation.zones).toMatchObject({ radiusMeters: 250, minReports: 2, windowMinutes: 180 });
    expect((await request(api()).get('/api/admin/settings').set(admin.auth)).body.data.automation.workload.overloadedAt).toBe(5);
    expect((await request(api()).put('/api/admin/settings').set(admin.auth).send({ automation: { zones: { radiusMeters: -4 } } })).status).toBe(400);
    expect((await request(api()).put('/api/admin/settings').set(admin.auth).send({ automation: { bogus: {} } })).status).toBe(400);
  });
});
