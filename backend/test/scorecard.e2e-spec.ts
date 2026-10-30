import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TRACKING_METRICS } from '../src/performance-tracking/metrics/tracking-metrics';
import { SCORECARD_AUDIT } from '../src/performance-tracking/scorecard/scorecard.service';

// Performance Tracking B3 (2026-10-30): the scorecard. Server-side rules
// (the user's): PM, Executive and Admin see everyone; a developer only
// their own; anyone else nothing. Baseline = no scores; below the minimum
// sample = Not enough data. Override (B4: named users only): reason
// required, audited, computed score kept, never on your own score. Excel: PM and Admin only, audited.
// Power BI feed: off unless a secret key is set; key in a header only.
describe('Performance Tracking scorecard (B3, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  const NIGHT = '2026-11-20';
  const KEY = 'feed-key-'.padEnd(48, 'x');

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  // A full night of rows: D1 90/100 (score 4), the rest small samples.
  const seedNight = async (userId: number, phase: 'baseline' | 'scoring') => {
    for (const metric of TRACKING_METRICS) {
      const big = metric === 'D1';
      await ds.query(
        `INSERT INTO performance_metric_snapshots ("tenantId", "snapshotDate", "projectId", "userId", metric, phase, value, numerator, denominator, sample, "enoughData", "windowFrom", details, "runId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '2026-10-24', '{}', 1)`,
        // Q5 and C3 (one review / one week is enough data) have none here.
        metric === 'Q5' || metric === 'C3'
          ? [f.tenants.t1, NIGHT, f.projects.pA, userId, metric, phase, null, null, null, 0, false]
          : [f.tenants.t1, NIGHT, f.projects.pA, userId, metric, phase, big ? 90 : 50, big ? 90 : 1, big ? 100 : 2, big ? 100 : 2, big],
      );
    }
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE performance_metric_snapshots, performance_score_overrides, performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`);
    await seedNight(f.users.devA.id, 'scoring');
    await seedNight(f.users.devNone.id, 'baseline');
    // B4: overrides by named user - Admin here, for the override tests.
    await http().patch('/performance-tracking/settings').set(auth(f.users.admin)).send({ overrideUserIds: [f.users.admin.id] }).expect(200);
  });

  afterAll(async () => {
    delete process.env.PERFORMANCE_FEED_KEY;
    delete process.env.PERFORMANCE_FEED_TENANT_ID;
    await app?.close();
  });

  describe('who sees what (server side)', () => {
    it('PM, Executive and Admin see everyone', async () => {
      for (const u of [f.users.pm, f.users.exec, f.users.admin]) {
        const body = (await get(u, '/performance-tracking/scorecard').expect(200)).body;
        expect(body.seesEveryone).toBe(true);
        expect(body.cards.map((c: any) => c.userId).sort()).toEqual([f.users.devA.id, f.users.devNone.id].sort());
      }
    });

    it('a developer sees only their own card, and gets 403 on anyone else', async () => {
      const body = (await get(f.users.devA, '/performance-tracking/scorecard').expect(200)).body;
      expect(body.seesEveryone).toBe(false);
      expect(body.cards.map((c: any) => c.userId)).toEqual([f.users.devA.id]);
      expect(body.canExport).toBe(false);
      await get(f.users.devA, `/performance-tracking/scorecard/people/${f.users.devA.id}`).expect(200);
      await get(f.users.devA, `/performance-tracking/scorecard/people/${f.users.devNone.id}`).expect(403);
    });

    it('QA and clients get nothing', async () => {
      await get(f.users.qaB, '/performance-tracking/scorecard').expect(403);
      await get(f.users.qaB, `/performance-tracking/scorecard/people/${f.users.devA.id}`).expect(403);
      await get(f.users.clientA, '/performance-tracking/scorecard').expect(403);
    });

    it('another tenant never sees this tenant', async () => {
      const body = (await get(f.users.pmT2, '/performance-tracking/scorecard').expect(200)).body;
      expect(body.cards).toEqual([]);
      await get(f.users.pmT2, `/performance-tracking/scorecard/people/${f.users.devA.id}`).expect(404);
    });
  });

  describe('Baseline and Not enough data', () => {
    it('a person in Baseline has no scores, only the label', async () => {
      const body = (await get(f.users.pm, `/performance-tracking/scorecard/people/${f.users.devNone.id}`).expect(200)).body;
      expect(body.card.state).toBe('baseline');
      expect(body.card.overall).toBeNull();
      expect(body.card.metrics.every((m: any) => m.state === 'baseline' && m.score === null)).toBe(true);
    });

    it('past Baseline: D1 is scored, small samples say Not enough data', async () => {
      const body = (await get(f.users.pm, `/performance-tracking/scorecard/people/${f.users.devA.id}`).expect(200)).body;
      const d1 = body.card.metrics.find((m: any) => m.metric === 'D1');
      expect(d1).toMatchObject({ state: 'scored', value: 90, score: 4 });
      expect(body.card.metrics.find((m: any) => m.metric === 'D2')).toMatchObject({ state: 'not_enough_data', score: null });
      expect(body.card.overall).toBe(4);
    });
  });

  describe('Technical Director override', () => {
    it('only named users; reason required; never on your own score; O5 not scored', async () => {
      const body = { userId: f.users.devA.id, metric: 'D1', score: 5, reason: 'Late only because the client moved the release' };
      await post(f.users.exec, '/performance-tracking/scorecard/overrides', body).expect(403);
      await post(f.users.pm, '/performance-tracking/scorecard/overrides', body).expect(403);
      await post(f.users.devA, '/performance-tracking/scorecard/overrides', body).expect(403);
      await post(f.users.admin, '/performance-tracking/scorecard/overrides', { ...body, reason: 'short' }).expect(400);
      await post(f.users.admin, '/performance-tracking/scorecard/overrides', { ...body, score: 6 }).expect(400);
      await post(f.users.admin, '/performance-tracking/scorecard/overrides', { ...body, metric: 'O5' }).expect(400);
      await post(f.users.admin, '/performance-tracking/scorecard/overrides', { ...body, userId: f.users.admin.id }).expect(403);
      await post(f.users.admin, '/performance-tracking/scorecard/overrides', { ...body, userId: f.users.devNone.id }).expect(400);
    });

    it('sets the score, keeps the computed one, and audits it; a second one replaces the first', async () => {
      const first = (
        await post(f.users.admin, '/performance-tracking/scorecard/overrides', { userId: f.users.devA.id, metric: 'D1', score: 5, reason: 'Late only because the client moved the release' }).expect(201)
      ).body;
      expect(first.card.metrics.find((m: any) => m.metric === 'D1')).toMatchObject({ score: 5, computedScore: 4, override: { originalScore: 4, overrideScore: 5 } });
      const [audit] = await ds.query(`SELECT * FROM audit_logs WHERE action = $1`, [SCORECARD_AUDIT.OVERRIDE_SET]);
      expect(JSON.parse(audit.details)).toMatchObject({ metric: 'D1', originalScore: 4, overrideScore: 5, reason: 'Late only because the client moved the release' });
      const second = (
        await post(f.users.admin, '/performance-tracking/scorecard/overrides', { userId: f.users.devA.id, metric: 'D1', score: 3, reason: 'Revised after the TD review meeting' }).expect(201)
      ).body;
      expect(second.card.metrics.find((m: any) => m.metric === 'D1')).toMatchObject({ score: 3, computedScore: 4 });
      const all = await ds.query(`SELECT * FROM performance_score_overrides ORDER BY id`);
      expect(all).toHaveLength(2);
      expect(all[0].removeReason).toBe('Replaced by a new override');
      expect(all[1].originalScore).toBe(4);
      // The developer sees the override on their own card, with its reason.
      const own = (await get(f.users.devA, `/performance-tracking/scorecard/people/${f.users.devA.id}`).expect(200)).body;
      expect(own.card.metrics.find((m: any) => m.metric === 'D1').override.reason).toBe('Revised after the TD review meeting');
      expect(own.canOverride).toBe(false);
    });

    it('removing needs a reason, is audited, and brings back the computed score', async () => {
      const [active] = await ds.query(`SELECT id FROM performance_score_overrides WHERE "removedAt" IS NULL`);
      await patch(f.users.admin, `/performance-tracking/scorecard/overrides/${active.id}/remove`, { reason: 'no' }).expect(400);
      await patch(f.users.pm, `/performance-tracking/scorecard/overrides/${active.id}/remove`, { reason: 'Not needed any more' }).expect(403);
      const body = (await patch(f.users.admin, `/performance-tracking/scorecard/overrides/${active.id}/remove`, { reason: 'Not needed any more' }).expect(200)).body;
      expect(body.card.metrics.find((m: any) => m.metric === 'D1')).toMatchObject({ score: 4, override: null });
      expect(await ds.query(`SELECT * FROM audit_logs WHERE action = $1`, [SCORECARD_AUDIT.OVERRIDE_REMOVED])).toHaveLength(1);
      expect(body.overrideHistory).toHaveLength(2);
    });

    it('who may override is a list of named people (Admin, Executive or PM accounts), audited', async () => {
      const body = { userId: f.users.devA.id, metric: 'Q1', score: 2, reason: 'Named Technical Director decision' };
      await patch(f.users.admin, '/performance-tracking/settings', { overrideUserIds: [f.users.exec.id] }).expect(200);
      await post(f.users.exec, '/performance-tracking/scorecard/overrides', body).expect(201);
      // Being an Admin is not enough any more.
      await post(f.users.admin, '/performance-tracking/scorecard/overrides', { ...body, metric: 'Q2' }).expect(403);
      const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'performance_tracking_settings_updated' ORDER BY id DESC LIMIT 1`);
      expect(JSON.parse(audit.details).after.overrideUserIds).toEqual([f.users.exec.id]);
      // A developer, a client, or someone in another tenant cannot be named.
      await patch(f.users.admin, '/performance-tracking/settings', { overrideUserIds: [f.users.devA.id] }).expect(400);
      await patch(f.users.admin, '/performance-tracking/settings', { overrideUserIds: [f.users.clientA.id] }).expect(400);
      await patch(f.users.admin, '/performance-tracking/settings', { overrideUserIds: [f.users.pmT2.id] }).expect(400);
      // Empty = nobody can override.
      await patch(f.users.admin, '/performance-tracking/settings', { overrideUserIds: [] }).expect(200);
      await post(f.users.exec, '/performance-tracking/scorecard/overrides', { ...body, metric: 'Q2' }).expect(403);
      const page = (await get(f.users.pm, '/performance-tracking/settings').expect(200)).body;
      expect(page.choices.overrideUsers.map((u: any) => u.id).sort()).toEqual([f.users.admin.id, f.users.pm.id, f.users.exec.id].sort());
      await patch(f.users.admin, '/performance-tracking/settings', { overrideUserIds: [f.users.admin.id] }).expect(200);
    });
  });

  describe('Excel export', () => {
    it('PM and Admin only, an .xlsx, audited; Executive and developers refused', async () => {
      await get(f.users.exec, '/performance-tracking/scorecard/export').expect(403);
      await get(f.users.devA, '/performance-tracking/scorecard/export').expect(403);
      for (const u of [f.users.pm, f.users.admin]) {
        const res = await get(u, '/performance-tracking/scorecard/export').buffer(true).expect(200);
        expect(res.headers['content-type']).toContain('spreadsheetml');
        expect(res.headers['content-disposition']).toContain(`performance-scorecard-${NIGHT}.xlsx`);
      }
      const audits = await ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [SCORECARD_AUDIT.EXPORTED]);
      expect(audits.map((a: any) => a.userId)).toEqual([f.users.pm.id, f.users.admin.id]);
      expect(JSON.parse(audits[0].details)).toMatchObject({ snapshotDate: NIGHT, people: 2 });
    });
  });

  describe('Power BI feed', () => {
    it('is off (404) with no key set, even with a login', async () => {
      await http().get('/performance-tracking/feed').expect(404);
      await get(f.users.admin, '/performance-tracking/feed').expect(404);
    });

    it('with a key set: wrong or missing key 401, the right key in the header reads the rows', async () => {
      process.env.PERFORMANCE_FEED_KEY = KEY;
      process.env.PERFORMANCE_FEED_TENANT_ID = String(f.tenants.t1);
      await http().get('/performance-tracking/feed').expect(401);
      await http().get('/performance-tracking/feed').set('X-Performance-Feed-Key', `${KEY}y`).expect(401);
      // A key in the URL is ignored.
      await http().get(`/performance-tracking/feed?key=${KEY}`).expect(401);
      const body = (await http().get('/performance-tracking/feed').set('X-Performance-Feed-Key', KEY).expect(200)).body;
      expect(body.snapshotDate).toBe(NIGHT);
      expect(body.rows).toHaveLength(2 * TRACKING_METRICS.length);
      expect(body.rows.find((r: any) => r.userId === f.users.devNone.id && r.metric === 'D1')).toMatchObject({ state: 'baseline', score: null });
    });
  });
});
