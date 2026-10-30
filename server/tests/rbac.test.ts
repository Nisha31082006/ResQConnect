import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { api, clearDb, createSos, makeUser, startDb, stopDb } from './helpers';
import type { Role } from '../src/models/shared';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const ROLES: Role[] = ['citizen', 'volunteer', 'team_leader', 'admin', 'food_provider', 'shelter_coordinator'];

describe('role-based access control is enforced by the backend', () => {
  it('rejects every protected route without a token', async () => {
    const routes: [string, string][] = [
      ['get', '/api/emergencies'],
      ['get', '/api/teams'],
      ['get', '/api/admin/stats'],
      ['get', '/api/map'],
      ['get', '/api/notifications'],
      ['get', '/api/shelters'],
      ['get', '/api/food/providers'],
      ['get', '/api/roads'],
      ['get', '/api/escalations'],
      ['post', '/api/sos'],
    ];
    for (const [method, url] of routes) {
      const res = await (request(api()) as unknown as Record<string, (u: string) => request.Test>)[method](url);
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });

  it('allows only administrators to use admin endpoints', async () => {
    const adminOnly: [string, string][] = [
      ['get', '/api/admin/stats'],
      ['get', '/api/admin/settings'],
      ['get', '/api/admin/audit'],
      ['get', '/api/users'],
      ['get', '/api/volunteers'],
      ['get', '/api/escalations'],
      ['post', '/api/escalations/run'],
      ['get', '/api/emergencies/duplicates/pairs'],
      ['get', '/api/roads/clearances/pending'],
    ];
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      const u = await makeUser(role);
      for (const [method, url] of adminOnly) {
        const res = await (request(api()) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(u.auth);
        expect(res.status, `${role} ${method} ${url}`).toBe(403);
      }
    }
    const admin = await makeUser('admin');
    for (const [method, url] of adminOnly) {
      const res = await (request(api()) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(admin.auth);
      expect(res.status, `admin ${method} ${url}`).toBe(200);
    }
  });

  it('prevents non-admins from creating teams, shelters, assignments or changing settings and roles', async () => {
    const leader = await makeUser('team_leader');
    const coordinator = await makeUser('shelter_coordinator');
    for (const u of [leader, coordinator]) {
      expect((await request(api()).post('/api/teams').set(u.auth).send({ name: 'Hack', leaderId: u.id })).status).toBe(403);
      expect((await request(api()).post('/api/shelters').set(u.auth).send({ name: 'x' })).status).toBe(403);
      expect((await request(api()).post('/api/assignments').set(u.auth).send({})).status).toBe(403);
      expect((await request(api()).put('/api/admin/settings').set(u.auth).send({ ackDeadlineSeconds: 20 })).status).toBe(403);
      expect((await request(api()).patch(`/api/users/${u.id}`).set(u.auth).send({ role: 'admin' })).status).toBe(403);
    }
  });

  it('keeps citizens away from other citizens’ data and responder-only endpoints', async () => {
    const a = await makeUser('citizen');
    const b = await makeUser('citizen', 'other');
    const sos = await createSos(a);
    expect((await request(api()).get(`/api/emergencies/${sos.id}`).set(b.auth)).status).toBe(403);
    expect((await request(api()).get(`/api/emergencies/${sos.id}/revisions`).set(b.auth)).status).toBe(403);
    expect((await request(api()).post(`/api/emergencies/${sos.id}/status`).set(a.auth).send({ to: 'acknowledged' })).status).toBe(403);
    expect((await request(api()).get('/api/teams').set(a.auth)).status).toBe(403);
    expect((await request(api()).get('/api/assignments').set(a.auth)).status).toBe(403);
    expect((await request(api()).get('/api/completion-reports').set(a.auth)).status).toBe(403);
  });

  it('shows food providers and shelter coordinators no emergency data at all', async () => {
    const a = await makeUser('citizen');
    await createSos(a);
    for (const role of ['food_provider', 'shelter_coordinator'] as Role[]) {
      const u = await makeUser(role);
      expect((await request(api()).get('/api/emergencies').set(u.auth)).status).toBe(403);
      const map = await request(api()).get('/api/map').set(u.auth);
      expect(map.status).toBe(200);
      expect(map.body.data.emergencies).toHaveLength(0);
    }
  });
});
