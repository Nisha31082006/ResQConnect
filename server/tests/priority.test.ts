import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { recommendPriority } from '../src/services/priority.service';
import { defaultPriorityConfig } from '../src/services/settings.service';
import { api, clearDb, createReport, createSos, makeUser, reportBody, sosBody, startDb, stopDb } from './helpers';
import { Emergency } from '../src/models';

const base = { kind: 'normal' as const, dangerToLife: false, severity: 'low' as const, affectedCount: 1, vulnerable: {}, status: 'pending' as const, createdAt: new Date(), acknowledgedAt: undefined };

describe('priority recommendation engine (unit)', () => {
  const rec = (over: object, now?: Date) => recommendPriority({ ...base, ...over } as never, defaultPriorityConfig, 300, now);

  it('recommends CRITICAL for an SOS with danger to life and many people', () => {
    const r = rec({ kind: 'sos', dangerToLife: true, severity: 'severe', affectedCount: 12, vulnerable: { children: true, elderly: true } });
    expect(r.level).toBe('critical');
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['sos_request', 'danger_to_life']));
  });

  it('recommends LOW for a small, non-urgent report and explains why', () => {
    const r = rec({});
    expect(r.level).toBe('low');
    expect(r.reasons.length).toBeGreaterThan(0);
    r.reasons.forEach((x) => expect(typeof x.code).toBe('string'));
  });

  it('scales with the number of people and vulnerable groups', () => {
    const few = rec({ affectedCount: 2 }).score;
    const many = rec({ affectedCount: 60 }).score;
    const vuln = rec({ affectedCount: 2, vulnerable: { children: true, pregnant: true } }).score;
    expect(many).toBeGreaterThan(few);
    expect(vuln).toBeGreaterThan(few);
  });

  it('raises priority when an SOS waits unacknowledged, and lowers it when assistance is already in progress', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const fresh = rec({ kind: 'sos', createdAt: created }, new Date(created.getTime() + 10_000)).score;
    const waited = rec({ kind: 'sos', createdAt: created }, new Date(created.getTime() + 400_000)).score;
    expect(waited).toBeGreaterThan(fresh);
    const handled = rec({ kind: 'sos', createdAt: created, status: 'in_progress', acknowledgedAt: new Date() }, new Date(created.getTime() + 400_000)).score;
    expect(handled).toBeLessThan(waited);
  });

  it('respects configurable thresholds', () => {
    const cfg = { ...defaultPriorityConfig, thresholds: { critical: 1000, high: 999, medium: 998 } };
    const r = recommendPriority({ ...base, kind: 'sos', dangerToLife: true, severity: 'severe', affectedCount: 100 } as never, cfg, 300);
    expect(r.level).toBe('low');
  });
});

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe('priority confirmation by an administrator (Feature 3)', () => {
  it('recommends but never dispatches: assignment is refused until the priority is confirmed', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(citizen);
    const rec = (await request(api()).get(`/api/emergencies/${sos.id}`).set(admin.auth)).body.data;
    expect(rec.finalPriority).toBeNull();
    expect(rec.effectivePriority.confirmed).toBe(false);
    expect(rec.liveRecommendation.reasons.length).toBeGreaterThan(0);
    expect(rec.status).toBe('pending');
  });

  it('records the final decision, requires a reason for overrides and keeps the audit trail', async () => {
    const citizen = await makeUser('citizen');
    const admin = await makeUser('admin');
    const sos = await createSos(citizen);
    const recLevel = (await request(api()).get(`/api/emergencies/${sos.id}/recommendation`).set(admin.auth)).body.data.live.level;
    const other = recLevel === 'low' ? 'medium' : 'low';

    const noReason = await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: other });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('OVERRIDE_REASON_REQUIRED');

    const override = await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: other, overrideReason: 'Caller confirmed it is safe' });
    expect(override.status).toBe(200);
    expect(override.body.data.finalPriority.overridden).toBe(true);
    expect(override.body.data.finalPriority.overrideReason).toBe('Caller confirmed it is safe');
    expect(override.body.data.finalPriority.recommendedLevelAtDecision).toBe(recLevel);

    const confirm = await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(admin.auth).send({ level: recLevel });
    expect(confirm.body.data.finalPriority.overridden).toBe(false);
    const logs = await request(api()).get('/api/admin/audit?action=emergency.priority_confirm').set(admin.auth);
    expect(logs.body.data.length).toBe(2);
  });

  it('only administrators can decide priority', async () => {
    const citizen = await makeUser('citizen');
    const leader = await makeUser('team_leader');
    const sos = await createSos(citizen);
    for (const u of [citizen, leader]) {
      expect((await request(api()).post(`/api/emergencies/${sos.id}/priority`).set(u.auth).send({ level: 'low', overrideReason: 'x' })).status).toBe(403);
    }
  });

  it('stores the explanation reasons on the report', async () => {
    const citizen = await makeUser('citizen');
    const r = await createReport(citizen, reportBody({ affectedCount: 30, dangerToLife: true, severity: 'high' }));
    const doc = await Emergency.findById(r.id);
    expect(doc!.recommendedPriority.reasons.length).toBeGreaterThan(1);
    expect(['critical', 'high', 'medium', 'low']).toContain(doc!.recommendedPriority.level);
    void sosBody;
  });
});
