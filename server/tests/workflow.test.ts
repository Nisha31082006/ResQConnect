import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { assertTransition } from '../src/services/emergency.service';
import { api, clearDb, createSos, makeUser, PNG_BYTES, startDb, stopDb, type TestUser } from './helpers';
import { Assignment, CompletionReport, Emergency } from '../src/models';

describe('status transition rules (unit)', () => {
  it('allows the documented workflow and nothing else', () => {
    expect(() => assertTransition('pending', 'acknowledged', 'admin')).not.toThrow();
    expect(() => assertTransition('acknowledged', 'assigned', 'admin')).not.toThrow();
    expect(() => assertTransition('assigned', 'in_progress', 'team_leader')).not.toThrow();
    expect(() => assertTransition('in_progress', 'completion_submitted', 'team_leader')).not.toThrow();
    expect(() => assertTransition('admin_verification', 'resolved', 'admin')).not.toThrow();
    expect(() => assertTransition('admin_verification', 'in_progress', 'admin')).not.toThrow();
  });
  it('rejects skipped steps and unauthorised roles', () => {
    expect(() => assertTransition('pending', 'resolved', 'admin')).toThrow(/Cannot change status/);
    expect(() => assertTransition('in_progress', 'resolved', 'admin')).toThrow();
    expect(() => assertTransition('admin_verification', 'resolved', 'team_leader')).toThrow(/cannot change status/);
    expect(() => assertTransition('pending', 'acknowledged', 'citizen')).toThrow();
    expect(() => assertTransition('resolved', 'in_progress', 'admin')).toThrow();
  });
});

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

async function scenario() {
  const admin = await makeUser('admin');
  const citizen = await makeUser('citizen');
  const leader = await makeUser('team_leader', 'leader');
  const member = await makeUser('volunteer', 'member');
  const outsider = await makeUser('team_leader', 'outsider');
  const team = (await request(api()).post('/api/teams').set(admin.auth).send({ name: 'Alpha', leaderId: leader.id, memberIds: [member.id], capacity: 4 })).body.data;
  const sos = await createSos(citizen);
  await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });
  await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: 'critical', overrideReason: 'confirmed' });
  const assignment = (await request(api()).post('/api/assignments').set(admin.auth).send({ emergencyId: sos.id, teamId: team.id })).body.data;
  return { admin, citizen, leader, member, outsider, team, sos, assignment };
}

const completion = (emergencyId: string, over: Record<string, unknown> = {}) => ({
  emergencyId,
  actionsPerformed: 'Evacuated five people by boat to the relief camp',
  peopleAssisted: 5,
  resourcesUsed: '1 boat, 5 life jackets',
  ...over,
});

const submit = (u: TestUser, body: Record<string, unknown>) => request(api()).post('/api/completion-reports').set(u.auth).send(body);

describe('completion verification workflow (Feature 7)', () => {
  it('walks through Pending -> Acknowledged -> Assigned -> In Progress -> Completion Submitted -> Verification -> Resolved with a timestamped trail', async () => {
    const { admin, citizen, leader, sos } = await scenario();
    expect((await Emergency.findById(sos.id))?.status).toBe('assigned');
    const start = await request(api()).post(`/api/emergencies/${sos.id}/status`).set(leader.auth).send({ to: 'in_progress', note: 'On site' });
    expect(start.status).toBe(200);
    expect(start.body.data.status).toBe('in_progress');

    const rep = await submit(leader, completion(sos.id));
    expect(rep.status).toBe(201);
    expect(rep.body.data.status).toBe('submitted');
    expect((await Emergency.findById(sos.id))?.status).toBe('completion_submitted');

    const review = await request(api()).post(`/api/completion-reports/${rep.body.data.id}/review`).set(admin.auth);
    expect(review.status).toBe(200);
    expect((await Emergency.findById(sos.id))?.status).toBe('admin_verification');

    const approve = await request(api()).post(`/api/completion-reports/${rep.body.data.id}/decision`).set(admin.auth).send({ approve: true });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('approved');
    const final = await Emergency.findById(sos.id);
    expect(final?.status).toBe('resolved');
    expect(final?.resolvedAt).toBeTruthy();
    expect(final?.statusHistory.map((h) => h.to)).toEqual(['pending', 'acknowledged', 'assigned', 'in_progress', 'completion_submitted', 'admin_verification', 'resolved']);
    final?.statusHistory.forEach((h) => expect(h.at).toBeInstanceOf(Date));
    expect((await Assignment.findOne({ emergency: sos.id }))?.status).toBe('completed');

    // The citizen is told, sees the full timeline, and can no longer edit the report.
    const mine = await request(api()).get(`/api/emergencies/${sos.id}`).set(citizen.auth);
    expect(mine.body.data.status).toBe('resolved');
    expect(mine.body.data.statusHistory).toHaveLength(7);
    expect((await request(api()).patch(`/api/emergencies/${sos.id}`).set(citizen.auth).send({ description: 'More info' })).status).toBe(409);
    const notes = await request(api()).get('/api/notifications').set(citizen.auth);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain('emergency_resolved');
  });

  it('never lets a team leader (or anyone but an admin) resolve an emergency', async () => {
    const { admin, leader, member, sos } = await scenario();
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(leader.auth).send({ to: 'in_progress' });
    for (const u of [leader, member]) {
      const direct = await request(api()).post(`/api/emergencies/${sos.id}/status`).set(u.auth).send({ to: 'resolved' });
      expect(direct.status).toBe(400); // not an allowed target of the status endpoint
    }
    const rep = (await submit(leader, completion(sos.id))).body.data;
    expect((await request(api()).post(`/api/completion-reports/${rep.id}/decision`).set(leader.auth).send({ approve: true })).status).toBe(403);
    expect((await request(api()).post(`/api/completion-reports/${rep.id}/review`).set(leader.auth)).status).toBe(403);
    expect((await Emergency.findById(sos.id))?.status).toBe('completion_submitted');
    void admin;
  });

  it('lets only the leader of the assigned team submit a completion report', async () => {
    const { leader, member, outsider, sos } = await scenario();
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(leader.auth).send({ to: 'in_progress' });
    expect((await submit(member, completion(sos.id))).status).toBe(403); // volunteer
    expect((await submit(outsider, completion(sos.id))).status).toBe(403); // leader of nothing
    expect(await CompletionReport.countDocuments()).toBe(0);
  });

  it('requires work to be in progress and valid report content', async () => {
    const { leader, sos } = await scenario();
    const early = await submit(leader, completion(sos.id));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('EMERGENCY_NOT_IN_PROGRESS');
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(leader.auth).send({ to: 'in_progress' });
    const bad = await submit(leader, completion(sos.id, { actionsPerformed: '', peopleAssisted: -1 }));
    expect(bad.status).toBe(400);
  });

  it('accepts optional evidence on completion reports', async () => {
    const { leader, sos } = await scenario();
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(leader.auth).send({ to: 'in_progress' });
    const res = await request(api()).post('/api/completion-reports').set(leader.auth).field('data', JSON.stringify(completion(sos.id))).attach('evidence', PNG_BYTES, { filename: 'done.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.evidence).toHaveLength(1);
  });

  it('sends rejected reports back for more work, with a mandatory reason, and allows a new submission', async () => {
    const { admin, leader, sos } = await scenario();
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(leader.auth).send({ to: 'in_progress' });
    const rep = (await submit(leader, completion(sos.id))).body.data;
    const noReason = await request(api()).post(`/api/completion-reports/${rep.id}/decision`).set(admin.auth).send({ approve: false });
    expect(noReason.status).toBe(400);
    const reject = await request(api()).post(`/api/completion-reports/${rep.id}/decision`).set(admin.auth).send({ approve: false, reason: 'Two people are still on the roof' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('rejected');
    expect((await Emergency.findById(sos.id))?.status).toBe('in_progress');
    const again = await submit(leader, completion(sos.id, { actionsPerformed: 'Evacuated the remaining two people' }));
    expect(again.status).toBe(201);
    const second = await request(api()).post(`/api/completion-reports/${again.body.data.id}/decision`).set(admin.auth).send({ approve: true, reason: 'Verified by phone' });
    expect(second.body.data.status).toBe('approved');
    expect((await Emergency.findById(sos.id))?.status).toBe('resolved');
    // A decided report cannot be decided twice.
    expect((await request(api()).post(`/api/completion-reports/${again.body.data.id}/decision`).set(admin.auth).send({ approve: false, reason: 'changed my mind' })).status).toBe(409);
    const audit = await request(api()).get('/api/admin/audit?entityType=CompletionReport').set(admin.auth);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['completion.reject', 'completion.approve']));
  });

  it('lets team members post progress updates but only the leader set the overall percentage', async () => {
    const { leader, member, outsider, assignment } = await scenario();
    const ok1 = await request(api()).post(`/api/assignments/${assignment.id}/progress`).set(member.auth).send({ note: 'Boat launched' });
    expect(ok1.status).toBe(200);
    expect((await request(api()).post(`/api/assignments/${assignment.id}/progress`).set(member.auth).send({ note: 'Halfway', percent: 50 })).status).toBe(403);
    const lead = await request(api()).post(`/api/assignments/${assignment.id}/progress`).set(leader.auth).send({ note: 'Halfway there', percent: 50 });
    expect(lead.status).toBe(200);
    expect(lead.body.data.progress).toHaveLength(2);
    expect((await request(api()).post(`/api/assignments/${assignment.id}/progress`).set(outsider.auth).send({ note: 'hi there' })).status).toBe(403);
  });

  it('does not allow acknowledging twice or skipping acknowledgement', async () => {
    const admin = await makeUser('admin');
    const citizen = await makeUser('citizen');
    const sos = await createSos(citizen);
    const ack = await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });
    expect(ack.status).toBe(200);
    const again = await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    const skip = await createSos(citizen);
    expect((await request(api()).post(`/api/emergencies/${skip.id}/status`).set(admin.auth).send({ to: 'in_progress' })).status).toBe(409);
  });
});
