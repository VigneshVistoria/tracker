import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures } from './setup/fixtures';

// Web sign-in sessions (2026-10-18): short access token + rotating refresh
// cookie for the web app; mobile/API logins unchanged.
describe('Web sign-in sessions (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let jwt: JwtService;
  let f: Fixtures;
  const PASSWORD = 'Correct-Horse-1';
  const HOST = 't1.tracker.vistoriasystems.com';
  const HOST_T2 = 't2.tracker.vistoriasystems.com';

  const http = () => request(app.getHttpServer());
  const web = { 'X-Client': 'web' };

  const cookieFrom = (res: request.Response): string | undefined => {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const line = (raw || []).find((c) => c.startsWith('tracker_refresh='));
    if (!line) return undefined;
    const value = line.split(';')[0].slice('tracker_refresh='.length);
    return value || undefined;
  };
  const decode = (token: string) => jwt.decode(token) as { sub: number; exp: number; iat: number };

  // Login allows 5 a minute per client IP - give each login its own.
  let ip = 0;
  const webLogin = async (email = f.users.pm.email) => {
    ip += 1;
    const res = await http().post('/auth/login').set('Host', HOST).set('X-Real-IP', `10.0.0.${ip}`).set(web).send({ email, password: PASSWORD }).expect(200);
    return { res, cookie: cookieFrom(res)!, token: res.body.accessToken as string };
  };
  const refresh = (cookie: string | undefined, host = HOST) => {
    const req = http().post('/auth/refresh').set('Host', host).set(web);
    return cookie ? req.set('Cookie', `tracker_refresh=${cookie}`) : req;
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    jwt = t.jwt;
    f = await seedFixtures(ds);
    const hash = await bcrypt.hash(PASSWORD, 4);
    await ds.query(`UPDATE users SET "passwordHash" = $1`, [hash]);
  });

  beforeEach(async () => {
    await ds.query(`TRUNCATE refresh_sessions RESTART IDENTITY`);
    delete process.env.SESSION_UPGRADE_UNTIL;
  });

  afterAll(async () => {
    await app.close();
  });

  it('web login sets an httpOnly, SameSite=Strict refresh cookie and a 15-minute access token', async () => {
    const { res, token } = await webLogin();
    const line = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tracker_refresh='))!;
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Strict/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/Path=\/api\/auth/);
    const { exp, iat } = decode(token);
    expect(exp - iat).toBe(15 * 60);
    expect(res.body.user.email).toBe(f.users.pm.email);
    const rows = await ds.query(`SELECT * FROM refresh_sessions`);
    expect(rows).toHaveLength(1);
    // Only the hash is stored, never the token itself.
    expect(rows[0].tokenHash).not.toBe(cookieFrom(res));
  });

  it('mobile / API login is unchanged: no cookie, 1-hour (test config) token', async () => {
    const res = await http().post('/auth/login').set('Host', HOST).set('X-Real-IP', '10.0.1.1').send({ email: f.users.pm.email, password: PASSWORD }).expect(200);
    expect(cookieFrom(res)).toBeUndefined();
    const { exp, iat } = decode(res.body.accessToken);
    expect(exp - iat).toBe(60 * 60);
    // Plain Bearer calls still work.
    await http().get('/notifications').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  it('refresh rotates the cookie and returns a working access token', async () => {
    const { cookie } = await webLogin();
    const res = await refresh(cookie).expect(200);
    const next = cookieFrom(res);
    expect(next).toBeDefined();
    expect(next).not.toBe(cookie);
    expect(res.body.user.id).toBe(f.users.pm.id);
    expect(decode(res.body.accessToken).sub).toBe(f.users.pm.id);
    // The new cookie keeps working.
    await refresh(next).expect(200);
  });

  it('two tabs refreshing with the same cookie at once both succeed (grace window)', async () => {
    const { cookie } = await webLogin();
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const rows = await ds.query(`SELECT "revokedAt" FROM refresh_sessions`);
    expect(rows[0].revokedAt).toBeNull();
  });

  it('reusing an old refresh token after the grace window revokes the whole session', async () => {
    const { cookie } = await webLogin();
    const first = await refresh(cookie).expect(200);
    await ds.query(`UPDATE refresh_sessions SET "rotatedAt" = now() - interval '5 minutes'`);
    await refresh(cookie).expect(401);
    // Even the legitimate newest cookie is now dead.
    await refresh(cookieFrom(first)).expect(401);
    const rows = await ds.query(`SELECT "revokedReason" FROM refresh_sessions`);
    expect(rows[0].revokedReason).toBe('reuse');
  });

  it('a failed refresh clears the cookie and says nothing about the token', async () => {
    const res = await refresh('not-a-real-token').expect(401);
    const line = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tracker_refresh='))!;
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(res.body.message).toBe('Session expired');
    await refresh(undefined).expect(401);
  });

  it('idle limit and absolute limit both end the session', async () => {
    const { cookie } = await webLogin();
    await ds.query(`UPDATE refresh_sessions SET "expiresAt" = now() - interval '1 minute'`);
    await refresh(cookie).expect(401);

    const second = await webLogin();
    await ds.query(`UPDATE refresh_sessions SET "absoluteExpiresAt" = now() - interval '1 minute' WHERE id = 2`);
    await refresh(second.cookie).expect(401);
  });

  it('a refresh never pushes the idle limit past the absolute limit', async () => {
    const { cookie } = await webLogin();
    await ds.query(`UPDATE refresh_sessions SET "absoluteExpiresAt" = now() + interval '1 hour'`);
    await refresh(cookie).expect(200);
    const [row] = await ds.query(`SELECT "expiresAt" <= "absoluteExpiresAt" AS ok FROM refresh_sessions`);
    expect(row.ok).toBe(true);
  });

  it('logout revokes the session on the server and clears the cookie', async () => {
    const { cookie } = await webLogin();
    await http().post('/auth/logout').set('Host', HOST).set(web).set('Cookie', `tracker_refresh=${cookie}`).expect(204);
    await refresh(cookie).expect(401);
  });

  it('cookie endpoints refuse calls without the web client header', async () => {
    const { cookie } = await webLogin();
    await http().post('/auth/refresh').set('Host', HOST).set('Cookie', `tracker_refresh=${cookie}`).expect(403);
    await http().post('/auth/logout').set('Host', HOST).set('Cookie', `tracker_refresh=${cookie}`).expect(403);
  });

  it('a session cannot be used from another tenant', async () => {
    const { cookie } = await webLogin();
    await refresh(cookie, HOST_T2).expect(401);
  });

  it('refresh returns the current role after a role change', async () => {
    const { cookie } = await webLogin(f.users.devA.email);
    await ds.query(`UPDATE users SET role = 'qa' WHERE id = $1`, [f.users.devA.id]);
    const res = await refresh(cookie).expect(200);
    expect(res.body.user.role).toBe('qa');
    await ds.query(`UPDATE users SET role = $2 WHERE id = $1`, [f.users.devA.id, f.users.devA.role]);
  });

  it('a deleted user cannot refresh', async () => {
    const email = 'gone@example.com';
    const hash = await bcrypt.hash(PASSWORD, 4);
    const [row] = await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, $2, $3, 'Gone', 'developer') RETURNING id`, [f.tenants.t1, email, hash]);
    const { cookie } = await webLogin(email);
    await ds.query(`DELETE FROM users WHERE id = $1`, [row.id]);
    await refresh(cookie).expect(401);
  });

  it('impersonation gets no refresh cookie, and exiting gives the admin a short token', async () => {
    const admin = await webLogin(f.users.admin.email);
    const imp = await http()
      .post(`/auth/impersonate/${f.users.devA.id}`)
      .set('Host', HOST)
      .set(web)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(cookieFrom(imp)).toBeUndefined();
    const exit = await http()
      .post('/auth/exit-impersonation')
      .set('Host', HOST)
      .set(web)
      .set('Cookie', `tracker_refresh=${admin.cookie}`)
      .set('Authorization', `Bearer ${imp.body.accessToken}`)
      .expect(200);
    const { exp, iat, sub } = decode(exit.body.accessToken);
    expect(sub).toBe(f.users.admin.id);
    expect(exp - iat).toBe(15 * 60);
    // The admin's own session still refreshes.
    await refresh(admin.cookie).expect(200);
  });

  describe('one-time upgrade of pre-session tokens', () => {
    const legacyToken = (iatOffsetSec: number, extra: Record<string, any> = {}) =>
      jwt.sign({ sub: f.users.pm.id, email: f.users.pm.email, tenantId: f.tenants.t1, iat: Math.floor(Date.now() / 1000) + iatOffsetSec, ...extra });
    const upgrade = (token: string) => http().post('/auth/session-upgrade').set('Host', HOST).set(web).set('Authorization', `Bearer ${token}`);

    it('is off unless SESSION_UPGRADE_UNTIL is set', async () => {
      await upgrade(legacyToken(-600)).expect(403);
    });

    it('swaps a token issued before the deploy for a web session', async () => {
      process.env.SESSION_UPGRADE_UNTIL = new Date(Date.now() + 23.9 * 3600 * 1000).toISOString(); // deployed 6 minutes ago
      const res = await upgrade(legacyToken(-30 * 60)).expect(200);
      expect(cookieFrom(res)).toBeDefined();
      expect(decode(res.body.accessToken).exp - decode(res.body.accessToken).iat).toBe(15 * 60);
      await refresh(cookieFrom(res)).expect(200);
    });

    it('refuses tokens issued after the deploy, impersonation tokens, and anything after the window', async () => {
      process.env.SESSION_UPGRADE_UNTIL = new Date(Date.now() + 23.9 * 3600 * 1000).toISOString();
      await upgrade(legacyToken(-60)).expect(403);
      await upgrade(legacyToken(-30 * 60, { impersonatorId: f.users.admin.id })).expect(403);
      process.env.SESSION_UPGRADE_UNTIL = new Date(Date.now() - 1000).toISOString();
      await upgrade(legacyToken(-30 * 60)).expect(403);
    });
  });
});
