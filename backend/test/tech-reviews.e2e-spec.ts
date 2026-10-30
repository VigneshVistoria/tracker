import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TECH_REVIEW_AUDIT, previousMonth } from '../src/tech-reviews/tech-reviews';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';
import { dateInZone } from '../src/team-settings/time-zone';

// Performance Tracking Q5 (2026-10-30): technical reviews by named
// reviewers, 1-5 rubric, N per person per month, evidence log, who sees
// what, and the nightly Q5 row.
describe('Technical review (Performance Tracking Q5, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  const month = dateInZone(new Date(), 'Africa/Addis_Ababa').slice(0, 7);
  const scores = (n: number) => ({ 'Code quality': n, 'Design and architecture': n, Testing: n, Security: n, Documentation: n });

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const review = (u: FixtureUser, extra: any = {}) =>
    post(u, '/tech-reviews', { revieweeUserId: f.users.devA.id, month, projectId: f.projects.pA, itemTitle: 'Refund API', scores: scores(4), ...extra });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, tech_reviews, tech_review_evidence, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('settings: reviewers are Admin/Executive/PM accounts; the rubric is checked', async () => {
    const { body } = await get(f.users.pm, '/performance-tracking/settings').expect(200);
    expect(body.settings).toMatchObject({ techReviewerUserIds: [], techReviewsPerMonth: 2, techReviewCriteria: ['Code quality', 'Design and architecture', 'Testing', 'Security', 'Documentation'] });
    await patch(f.users.pm, '/performance-tracking/settings', { techReviewerUserIds: [f.users.devA.id] }).expect(400);
    await patch(f.users.pm, '/performance-tracking/settings', { techReviewCriteria: ['Testing', 'testing'] }).expect(400);
    await patch(f.users.pm, '/performance-tracking/settings', { techReviewerUserIds: [f.users.exec.id] }).expect(200);
  });

  it('nobody reviews into an untracked project; only named reviewers write reviews', async () => {
    expect((await get(f.users.exec, `/tech-reviews?month=${month}`).expect(200)).body.canReview).toBe(false);
    await review(f.users.exec).expect(400);
    await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(200);
    await review(f.users.pm).expect(403);
    await review(f.users.admin).expect(403);
  });

  it('refuses a bad rubric, the wrong month, a non-developer, and missing scores', async () => {
    await review(f.users.exec, { scores: { ...scores(4), Testing: 6 } }).expect(400);
    await review(f.users.exec, { scores: { 'Code quality': 4 } }).expect(400);
    await review(f.users.exec, { month: '2020-01' }).expect(400);
    await review(f.users.exec, { revieweeUserId: f.users.qaB.id }).expect(400);
    await review(f.users.exec, { projectId: undefined }).expect(400);
  });

  it('writes reviews up to the monthly number (2), audited; last month allowed', async () => {
    const { body } = await review(f.users.exec).expect(201);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ revieweeName: 'Name devA', reviewerName: 'Name exec', average: 4, canEdit: true, canAddEvidence: true });
    expect(body.people.find((p: any) => p.userId === f.users.devA.id)).toMatchObject({ count: 1, average: 4 });
    await review(f.users.exec, { itemTitle: 'Claims import', scores: { ...scores(3), Security: 5 } }).expect(201);
    const third = await review(f.users.exec, { itemTitle: 'One too many' }).expect(400);
    expect(third.body.message).toMatch(/already has 2/);
    await review(f.users.exec, { month: previousMonth(month), itemTitle: 'Last month' }).expect(201);
    expect(await audits(TECH_REVIEW_AUDIT.CREATED)).toHaveLength(3);
  });

  it('only the reviewer edits, with before/after audited', async () => {
    const [r] = await ds.query(`SELECT id FROM tech_reviews WHERE "itemTitle" = 'Refund API'`);
    await patch(f.users.pm, `/tech-reviews/${r.id}`, { comment: 'x' }).expect(403);
    const { body } = await patch(f.users.exec, `/tech-reviews/${r.id}`, { scores: scores(5), comment: 'Clean' }).expect(200);
    expect(body.reviews.find((x: any) => x.id === r.id)).toMatchObject({ average: 5, comment: 'Clean' });
    const [a] = await audits(TECH_REVIEW_AUDIT.UPDATED);
    expect(JSON.parse(a.details)).toMatchObject({ before: { comment: null }, after: { comment: 'Clean', average: '5' } });
  });

  it('evidence log: reviewer, the person reviewed, PM; not another developer', async () => {
    const [r] = await ds.query(`SELECT id FROM tech_reviews WHERE "itemTitle" = 'Refund API'`);
    await post(f.users.devA, `/tech-reviews/${r.id}/evidence`, { note: 'PR 42 shows the tests', link: 'https://git/pr/42' }).expect(201);
    await post(f.users.pm, `/tech-reviews/${r.id}/evidence`, { note: 'Agreed in the demo' }).expect(201);
    await post(f.users.devNone, `/tech-reviews/${r.id}/evidence`, { note: 'Not mine' }).expect(403);
    const { body } = await get(f.users.exec, `/tech-reviews?month=${month}`).expect(200);
    expect(body.reviews.find((x: any) => x.id === r.id).evidence.map((e: any) => e.addedByName)).toEqual(['Name devA', 'Name pm']);
    expect(await audits(TECH_REVIEW_AUDIT.EVIDENCE_ADDED)).toHaveLength(2);
  });

  it('who sees: developers only their own, QA nothing', async () => {
    expect((await get(f.users.devA, `/tech-reviews?month=${month}`).expect(200)).body.reviews).toHaveLength(2);
    const other = await get(f.users.devNone, `/tech-reviews?month=${month}`).expect(200);
    expect(other.body.reviews).toHaveLength(0);
    expect(other.body.people.map((p: any) => p.userId)).toEqual([f.users.devNone.id]);
    await get(f.users.qaB, `/tech-reviews?month=${month}`).expect(403);
  });

  it('the nightly run writes Q5 = the average review score in the window', async () => {
    const result = await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' });
    expect(result.status).toBe('done');
    const [row] = await ds.query(`SELECT value, sample, "enoughData" FROM performance_metric_snapshots WHERE metric = 'Q5' AND "userId" = $1`, [f.users.devA.id]);
    // 5 (edited), 3.4 and 4 (last month's, written today) - all written in the window.
    expect(row).toMatchObject({ sample: 3, enoughData: true });
    expect(Number(row.value)).toBeCloseTo(4.13, 2);
  });
});
