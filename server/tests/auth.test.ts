import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { api, clearDb, makeUser, PASSWORD, startDb, stopDb } from './helpers';
import { User } from '../src/models';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe('registration and login', () => {
  it('registers a citizen who can sign in immediately and never stores the plain password', async () => {
    const res = await request(api()).post('/api/auth/register').send({ name: 'Ravi Kumar', email: 'Ravi@Example.com', password: 'Strong#123', phone: '+919876543210' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe('ravi@example.com');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const stored = await User.findOne({ email: 'ravi@example.com' }).select('+passwordHash');
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toContain('Strong#123');
    expect(stored?.passwordHash.startsWith('$2')).toBe(true);
  });

  it('rejects duplicate emails with 409', async () => {
    const body = { name: 'A B', email: 'dup@example.com', password: 'Strong#123' };
    expect((await request(api()).post('/api/auth/register').send(body)).status).toBe(201);
    const again = await request(api()).post('/api/auth/register').send(body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns validation error codes for weak passwords and bad emails', async () => {
    const res = await request(api()).post('/api/auth/register').send({ name: 'A', email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('does not allow self-registration as administrator or team leader', async () => {
    for (const role of ['admin', 'team_leader']) {
      const res = await request(api()).post('/api/auth/register').send({ name: 'Mallory', email: `${role}@example.com`, password: 'Strong#123', role });
      expect(res.status).toBe(400);
    }
    expect(await User.countDocuments({ role: 'admin' })).toBe(0);
  });

  it('keeps volunteers pending (cannot sign in) until an administrator approves them', async () => {
    const reg = await request(api()).post('/api/auth/register').send({ name: 'Vol Un', email: 'vol@example.com', password: 'Strong#123', role: 'volunteer' });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.status).toBe('pending');
    const login = await request(api()).post('/api/auth/login').send({ email: 'vol@example.com', password: 'Strong#123' });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('AUTH_PENDING_APPROVAL');

    const admin = await makeUser('admin');
    const volunteer = await User.findOne({ email: 'vol@example.com' });
    const approve = await request(api()).patch(`/api/users/${volunteer!._id}`).set(admin.auth).send({ status: 'active' });
    expect(approve.status).toBe(200);
    const ok = await request(api()).post('/api/auth/login').send({ email: 'vol@example.com', password: 'Strong#123' });
    expect(ok.status).toBe(200);
  });

  it('logs in with correct credentials and rejects wrong ones without revealing which part was wrong', async () => {
    const u = await makeUser('citizen');
    const good = await request(api()).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(good.status).toBe(200);
    const badPw = await request(api()).post('/api/auth/login').send({ email: u.email, password: 'Wrong#12345' });
    const noUser = await request(api()).post('/api/auth/login').send({ email: 'ghost@example.com', password: PASSWORD });
    expect(badPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('protects /auth/me with a valid JWT and rejects tampered tokens', async () => {
    const u = await makeUser('citizen');
    expect((await request(api()).get('/api/auth/me')).status).toBe(401);
    expect((await request(api()).get('/api/auth/me').set('Authorization', `Bearer ${u.token}x`)).status).toBe(401);
    const me = await request(api()).get('/api/auth/me').set(u.auth);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(u.email);
  });

  it('lets users update their profile but not their role, and change their password', async () => {
    const u = await makeUser('citizen');
    const upd = await request(api()).patch('/api/auth/me').set(u.auth).send({ name: 'New Name', preferredLanguage: 'ta' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.user.preferredLanguage).toBe('ta');
    const escalate = await request(api()).patch('/api/auth/me').set(u.auth).send({ role: 'admin' });
    expect(escalate.status).toBe(400);
    expect((await User.findById(u.id))?.role).toBe('citizen');

    const pw = await request(api()).post('/api/auth/change-password').set(u.auth).send({ currentPassword: PASSWORD, newPassword: 'Another#4567' });
    expect(pw.status).toBe(200);
    expect((await request(api()).post('/api/auth/login').send({ email: u.email, password: 'Another#4567' })).status).toBe(200);
    expect((await request(api()).post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(401);
  });

  it('blocks suspended users immediately even with a valid token', async () => {
    const admin = await makeUser('admin');
    const u = await makeUser('citizen');
    await request(api()).patch(`/api/users/${u.id}`).set(admin.auth).send({ status: 'suspended' });
    const res = await request(api()).get('/api/auth/me').set(u.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_SUSPENDED');
  });
});
