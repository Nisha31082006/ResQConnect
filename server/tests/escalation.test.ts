import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { evaluateEscalations, levelThresholdSeconds, runEscalationCheck } from '../src/services/escalation.service';
import { api, clearDb, createReport, createSos, makeUser, startDb, stopDb } from './helpers';
import { Emergency, Escalation, Notification } from '../src/models';

describe('escalation decision logic (unit)', () => {
  const now = new Date('2026-01-01T01:00:00Z');
  const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000);

  it('does nothing before the acknowledgement deadline', () => {
    expect(evaluateEscalations([{ id: 'a', createdAt: at(299) }], new Map(), now, 300, 3)).toEqual([]);
  });
  it('creates level 1 at the deadline and later levels at doubling intervals', () => {
    expect(levelThresholdSeconds(1, 300)).toBe(300);
    expect(levelThresholdSeconds(2, 300)).toBe(600);
    expect(levelThresholdSeconds(3, 300)).toBe(1200);
    expect(evaluateEscalations([{ id: 'a', createdAt: at(300) }], new Map(), now, 300, 3).map((d) => d.level)).toEqual([1]);
    expect(evaluateEscalations([{ id: 'a', createdAt: at(650) }], new Map([['a', new Set([1])]]), now, 300, 3).map((d) => d.level)).toEqual([2]);
  });
  it('never repeats a level that was already recorded and never exceeds the maximum level', () => {
    expect(evaluateEscalations([{ id: 'a', createdAt: at(99999) }], new Map([['a', new Set([1, 2, 3])]]), now, 300, 3)).toEqual([]);
    expect(evaluateEscalations([{ id: 'a', createdAt: at(99999) }], new Map(), now, 300, 2).map((d) => d.level)).toEqual([1, 2]);
  });
});

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const backdate = (id: string, seconds: number) => Emergency.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(id) }, { $set: { createdAt: new Date(Date.now() - seconds * 1000) } });

describe('SOS escalation monitoring (Feature 11)', () => {
  it('flags only overdue, unacknowledged SOS requests, exactly once per level, and notifies admins', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const overdue = await createSos(citizen);
    const fresh = await createSos(citizen);
    const normal = await createReport(citizen);
    await backdate(overdue.id, 400);
    await backdate(normal.id, 4000); // not an SOS: never escalated

    const first = await runEscalationCheck();
    expect(first.created).toBe(1);
    const second = await runEscalationCheck();
    expect(second.created).toBe(0); // deduplicated
    const docs = await Escalation.find({});
    expect(docs).toHaveLength(1);
    expect(String(docs[0].emergency)).toBe(overdue.id);
    expect(docs[0].level).toBe(1);
    expect(docs[0].status).toBe('open');
    expect(docs[0].waitedSecondsAtTrigger).toBeGreaterThanOrEqual(400);

    const notes = await Notification.find({ user: admin.id, type: 'sos_escalated' });
    expect(notes).toHaveLength(1);

    // Later, a second level is created once; the fresh SOS is still untouched.
    await backdate(overdue.id, 700);
    expect((await runEscalationCheck()).created).toBe(1);
    expect((await runEscalationCheck()).created).toBe(0);
    expect(await Escalation.countDocuments({ emergency: fresh.id })).toBe(0);
  });

  it('survives overlapping runs without duplicates', async () => {
    const citizen = await makeUser('citizen');
    const sos = await createSos(citizen);
    await backdate(sos.id, 500);
    await Promise.all([runEscalationCheck(), runEscalationCheck(), runEscalationCheck()]);
    expect(await Escalation.countDocuments()).toBe(1);
  });

  it('stops escalating once the SOS is acknowledged and auto-resolves open escalations', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(citizen);
    await backdate(sos.id, 500);
    await runEscalationCheck();
    expect((await request(api()).get('/api/escalations?status=open').set(admin.auth)).body.data).toHaveLength(1);
    await request(api()).post(`/api/emergencies/${sos.id}/status`).set(admin.auth).send({ to: 'acknowledged' });
    const esc = await Escalation.findOne({});
    expect(esc?.status).toBe('resolved');
    await backdate(sos.id, 5000);
    expect((await runEscalationCheck()).created).toBe(0);
  });

  it('uses the configurable acknowledgement deadline', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(citizen);
    await backdate(sos.id, 40);
    expect((await runEscalationCheck()).created).toBe(0);
    const upd = await request(api()).put('/api/admin/settings').set(admin.auth).send({ ackDeadlineSeconds: 30 });
    expect(upd.status).toBe(200);
    expect((await runEscalationCheck()).created).toBe(1);
    expect((await request(api()).get('/api/admin/audit?action=settings.update').set(admin.auth)).body.data).toHaveLength(1);
  });

  it('lets administrators see elapsed time, acknowledge and resolve escalations (and only them)', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(citizen);
    await backdate(sos.id, 450);
    const monitor = await request(api()).get('/api/escalations/monitor').set(admin.auth);
    expect(monitor.body.data.pendingSos[0]).toMatchObject({ id: sos.id, overdue: true });
    expect(monitor.body.data.pendingSos[0].waitedSeconds).toBeGreaterThanOrEqual(450);

    const run = await request(api()).post('/api/escalations/run').set(admin.auth);
    expect(run.body.data.created).toBe(1);
    const list = await request(api()).get('/api/escalations').set(admin.auth);
    const e = list.body.data[0];
    expect(e.elapsedSeconds).toBeGreaterThanOrEqual(450);
    expect(e.emergency.emergencyId).toBe(sos.emergencyId);
    expect((await request(api()).post(`/api/escalations/${e.id}/acknowledge`).set(citizen.auth).send({})).status).toBe(403);
    const ack = await request(api()).post(`/api/escalations/${e.id}/acknowledge`).set(admin.auth).send({ note: 'Calling the reporter' });
    expect(ack.body.data.status).toBe('acknowledged');
    expect((await request(api()).post(`/api/escalations/${e.id}/acknowledge`).set(admin.auth).send({})).status).toBe(409);
    const res = await request(api()).post(`/api/escalations/${e.id}/resolve`).set(admin.auth).send({});
    expect(res.body.data.status).toBe('resolved');
  });
});
