import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { scoreCandidate } from '../src/services/assignment.service';
import { api, clearDb, createSos, makeUser, startDb, stopDb } from './helpers';
import { Assignment, Emergency } from '../src/models';

describe('candidate scoring (unit)', () => {
  it('prefers matching skills, availability and low workload', () => {
    const good = scoreCandidate(['boat', 'rescue'], ['boat', 'rescue'], 'available', 0).score;
    const partial = scoreCandidate(['boat', 'rescue'], ['boat'], 'available', 0).score;
    const busy = scoreCandidate(['boat', 'rescue'], ['boat', 'rescue'], 'busy', 3).score;
    expect(good).toBeGreaterThan(partial);
    expect(good).toBeGreaterThan(busy);
  });
});

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

async function setup() {
  const admin = await makeUser('admin');
  const citizen = await makeUser('citizen');
  const leader = await makeUser('team_leader', 'leader', { skills: ['rescue', 'boat'] });
  const vol1 = await makeUser('volunteer', 'vol1', { skills: ['rescue'] });
  const vol2 = await makeUser('volunteer', 'vol2', { skills: ['medical'] });
  return { admin, citizen, leader, vol1, vol2 };
}

const makeTeam = (admin: { auth: Record<string, string> }, leaderId: string, memberIds: string[], extra: Record<string, unknown> = {}) =>
  request(api()).post('/api/teams').set(admin.auth).send({ name: `Team ${Math.random().toString(36).slice(2, 6)}`, leaderId, memberIds, skills: ['rescue'], capacity: 4, ...extra });

describe('manual team creation and allocation (Feature 6)', () => {
  it('lets an admin create a team with a leader, members, skills and capacity', async () => {
    const { admin, leader, vol1 } = await setup();
    const res = await makeTeam(admin, leader.id, [vol1.id]);
    expect(res.status).toBe(201);
    expect(res.body.data.memberCount).toBe(2);
    expect(res.body.data.leader.id).toBe(leader.id);
    expect(res.body.data.capacity).toBe(4);
    const leaderView = await request(api()).get('/api/teams').set(leader.auth);
    expect(leaderView.body.data).toHaveLength(1);
  });

  it('validates roles, capacity and double membership', async () => {
    const { admin, citizen, leader, vol1, vol2 } = await setup();
    expect((await makeTeam(admin, vol1.id, [])).body.error.code).toBe('LEADER_ROLE_REQUIRED');
    expect((await makeTeam(admin, leader.id, [citizen.id])).body.error.code).toBe('VOLUNTEER_ROLE_REQUIRED');
    expect((await makeTeam(admin, leader.id, [vol1.id, vol2.id], { capacity: 2 })).body.error.code).toBe('TEAM_CAPACITY_EXCEEDED');
    expect((await makeTeam(admin, leader.id, [vol1.id])).status).toBe(201);
    const other = await makeUser('team_leader', 'leader2');
    const dup = await makeTeam(admin, other.id, [vol1.id]);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USER_ALREADY_IN_TEAM');
  });

  it('refuses to assign anyone before the priority is confirmed, then assigns manually and shows the staffing gap', async () => {
    const { admin, citizen, leader, vol1 } = await setup();
    const team = (await makeTeam(admin, leader.id, [vol1.id])).body.data;
    const sos = await createSos(citizen);
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });

    const early = await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: sos.id, teamId: team.id });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('PRIORITY_NOT_CONFIRMED');

    const rec = (await request(api()).get(`/api/emergencies/${sos.id}/recommendation`).set(admin.auth)).body.data.live.level;
    await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: rec });
    await request(api()).put(`/api/emergencies/${sos.id}/requirements`).set(admin.auth).send({ requiredVolunteers: 5, requiredSkills: ['rescue'] });

    const res = await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: sos.id, teamId: team.id, instructions: 'Bring a boat' });
    expect(res.status).toBe(201);
    expect(res.body.meta.staffing).toMatchObject({ required: 5, assigned: 2, gap: 3 });
    expect((await Emergency.findById(sos.id))?.status).toBe('assigned');

    const again = await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: sos.id, teamId: team.id });
    expect(again.body.error.code).toBe('TEAM_ALREADY_ASSIGNED');

    const detail = await request(api()).get(`/api/emergencies/${sos.id}`).set(admin.auth);
    expect(detail.body.data.staffing.gap).toBe(3);
    const list = await request(api()).get('/api/emergencies').set(admin.auth);
    expect(list.body.data[0].staffing.gap).toBe(3);
  });

  it('only suggests volunteers and teams; suggestions never create assignments', async () => {
    const { admin, citizen, leader, vol1, vol2 } = await setup();
    await makeTeam(admin, leader.id, [vol1.id]);
    const sos = await createSos(citizen);
    await request(api()).put(`/api/emergencies/${sos.id}/requirements`).set(admin.auth).send({ requiredVolunteers: 2, requiredSkills: ['medical'] });
    const res = await request(api()).get(`/api/emergencies/${sos.id}/suggestions`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.volunteers[0].id).toBe(vol2.id); // the only medical skill
    expect(res.body.data.teams.length).toBe(1);
    expect(await Assignment.countDocuments()).toBe(0);
  });

  it('reassigns only with a recorded reason, keeps the previous assignment as history and writes an audit log', async () => {
    const { admin, citizen, leader, vol1, vol2 } = await setup();
    const leader2 = await makeUser('team_leader', 'leader2');
    const t1 = (await makeTeam(admin, leader.id, [vol1.id])).body.data;
    const t2 = (await makeTeam(admin, leader2.id, [vol2.id])).body.data;
    const sos = await createSos(citizen);
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });
    await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: 'critical', overrideReason: 'urgent' });
    const first = (await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: sos.id, teamId: t1.id })).body.data;

    const noReason = await request(api()).post(`/api/assignments/${first.id}/reassign`).set(admin.auth).send({ teamId: t2.id });
    expect(noReason.status).toBe(400);
    const res = await request(api()).post(`/api/assignments/${first.id}/reassign`).set(admin.auth).send({ teamId: t2.id, reason: 'Team 1 is too far away' });
    expect(res.status).toBe(200);
    expect(res.body.data.team.id).toBe(t2.id);
    expect(res.body.data.reassignReason).toBe('Team 1 is too far away');

    const all = await Assignment.find({ emergency: sos.id });
    expect(all).toHaveLength(2);
    expect(all.find((a) => String(a._id) === first.id)?.status).toBe('reassigned');
    // The old team no longer sees the emergency; the new one does.
    expect((await request(api()).get(`/api/emergencies/${sos.id}`).set(leader.auth)).status).toBe(403);
    expect((await request(api()).get(`/api/emergencies/${sos.id}`).set(leader2.auth)).status).toBe(200);
    expect((await request(api()).get('/api/admin/audit?action=assignment.reassign').set(admin.auth)).body.data).toHaveLength(1);
  });

  it('shows team members only their own team’s emergencies', async () => {
    const { admin, citizen, leader, vol1, vol2 } = await setup();
    const t1 = (await makeTeam(admin, leader.id, [vol1.id])).body.data;
    const sos = await createSos(citizen);
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });
    await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: 'high', overrideReason: 'x' });
    await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: sos.id, teamId: t1.id });
    expect((await request(api()).get('/api/emergencies').set(vol1.auth)).body.data).toHaveLength(1);
    expect((await request(api()).get('/api/emergencies').set(vol2.auth)).body.data).toHaveLength(0);
    expect((await request(api()).get(`/api/emergencies/${sos.id}`).set(vol2.auth)).status).toBe(403);
    // Responders do not get reporter identity.
    const view = (await request(api()).get(`/api/emergencies/${sos.id}`).set(vol1.auth)).body.data;
    expect(view.reporter).toBeUndefined();
  });
});
