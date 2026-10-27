import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Non-Compliance Report "Late to QA" + "Overdue in review" (2026-10-27,
// approved by the user; replaces "Missed SLA"). Late to QA is judged on the
// developer's FINAL submission against the effective Due date; time waiting
// on QA, a peer or the PM never counts; Hold/Closed/Escalated are left out;
// each task counts once. Overdue in review is information only. Flag
// thresholds come from the settings.
describe('Non-Compliance Report: Late to QA (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  const ids: Record<string, number> = {};
  const DUE = '2026-10-05'; // a Monday, well before "today"

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });

  const task = async (key: string, values: Record<string, any>) => {
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Task ${key}`,
      description: 'x',
      status: 'Development',
      dueDate: DUE,
      assigneeUserId: f.users.devA.id,
      assigneeEmail: f.users.devA.email,
      createdByUserId: f.users.pm.id,
      createdByEmail: f.users.pm.email,
      ...values,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    ids[key] = res[0].id;
  };
  let round = 0;
  const submit = (key: string, submittedAt: string, status: string, reviewType = 'qa', reviewedAt: string | null = null) =>
    ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "resolution", "submittedByUserId", "submittedByEmail", "submittedAt", "status", "reviewType", "reviewedAt")
       VALUES ($1, $2, $3, 'done', $4, $5, $6, $7, $8, $9)`,
      [f.tenants.t1, ids[key], ++round, f.users.devA.id, f.users.devA.email, submittedAt, status, reviewType, reviewedAt],
    );
  const report = async () => (await http().get('/non-compliance-report').set(auth(f.users.pm)).expect(200)).body;
  const devA = async () => (await report()).developers.find((d: any) => d.userId === f.users.devA.id);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, audit_logs, task_commitment_events, performance_metric_settings RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;

    // Submitted on time, still waiting for QA past both dates: NOT late,
    // but overdue in review.
    await task('waitingOnQa', { status: 'Feedback', qaReviewDueDate: '2026-10-09' });
    await submit('waitingOnQa', '2026-10-02T09:00:00Z', 'pending');
    // Submitted on time, passed by QA after the Due date: NOT late.
    await task('passedLate', { status: 'Pass', completedAt: '2026-10-20T09:00:00Z' });
    await submit('passedLate', '2026-10-03T09:00:00Z', 'approved', 'qa', '2026-10-20T09:00:00Z');
    // Submitted after the Due date and still waiting: late ONCE (also overdue in review).
    await task('submittedLate', { status: 'Feedback', qaReviewDueDate: '2026-10-15' });
    await submit('submittedLate', '2026-10-08T09:00:00Z', 'pending');
    // Rejected before the Due date, fixed after it: late (final submission).
    await task('reworkLate', { status: 'Re-Feedback', qaReviewDueDate: '2099-01-01' });
    await submit('reworkLate', '2026-10-01T09:00:00Z', 'rejected', 'qa', '2026-10-02T09:00:00Z');
    await submit('reworkLate', '2026-10-12T09:00:00Z', 'pending');
    // Still with the developer past the Due date: late.
    await task('stillWithDev', { status: 'Development' });
    // Sent back by the PM (withdrawn) - not a submission; still with developer: late.
    await task('pmFeedback', { status: 'PM Feedback' });
    await submit('pmFeedback', '2026-10-02T09:00:00Z', 'rejected', 'pm', '2026-10-03T09:00:00Z');
    // PM wait extends the Due date: due 2026-10-05 + 5 working days = 2026-10-12; submitted 10-09: NOT late.
    await task('pmWait', { status: 'Feedback', pmWaitWorkingDays: 5, qaReviewDueDate: '2099-01-01' });
    await submit('pmWait', '2026-10-09T09:00:00Z', 'pending');
    // Left out entirely.
    await task('hold', { status: 'Hold' });
    await task('closed', { status: 'Closed' });
    await task('escalated', { status: 'Escalated' });
    await task('pendingPm', { status: 'Pending PM Review' });
    await task('noDue', { status: 'Development', dueDate: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('counts only the developer’s own lateness, once per task', async () => {
    const d = await devA();
    const late = Object.fromEntries(d.lateToQa.items.map((i: any) => [i.taskId, i]));
    expect(Object.keys(late).map(Number).sort((a, b) => a - b)).toEqual([ids.submittedLate, ids.reworkLate, ids.stillWithDev, ids.pmFeedback].sort((a, b) => a - b));
    expect(late[ids.submittedLate]).toMatchObject({ reason: 'submitted_late', effectiveDueDate: DUE, submittedAt: '2026-10-08', daysLate: 3 });
    expect(late[ids.reworkLate]).toMatchObject({ reason: 'submitted_late', submittedAt: '2026-10-12', daysLate: 7 });
    expect(late[ids.stillWithDev]).toMatchObject({ reason: 'still_with_developer', submittedAt: null });
    expect(late[ids.pmFeedback]).toMatchObject({ reason: 'still_with_developer' });
    expect(d.lateToQa.count).toBe(4);
  });

  it('shows reviewer overdue as information only', async () => {
    const d = await devA();
    expect(d.overdueInReview.items.map((i: any) => i.taskId).sort((a: number, b: number) => a - b)).toEqual([ids.waitingOnQa, ids.submittedLate].sort((a, b) => a - b));
    expect(d.overdueInReview.items.find((i: any) => i.taskId === ids.waitingOnQa)).toMatchObject({ status: 'Feedback', qaReviewDueDate: '2026-10-09', submittedAt: '2026-10-02' });
  });

  it('flags on the thresholds from the settings, never on Overdue in review', async () => {
    const before = await report();
    expect(before.thresholds).toEqual({ lateToQaCount: 3, rejectionRatePercent: 20, rejectionRateMinSubmissions: 3, escalationCount: 1, vagueNotesCount: 3 });
    expect((await devA()).lateToQa.flagged).toBe(true);

    await http().patch('/performance-metrics/settings').set(auth(f.users.pm)).send({ lateToQaFlagCount: 5, rejectionRateFlagPercent: 60 }).expect(200);
    const after = await report();
    expect(after.thresholds).toMatchObject({ lateToQaCount: 5, rejectionRatePercent: 60 });
    const d = after.developers.find((x: any) => x.userId === f.users.devA.id);
    expect(d.lateToQa.flagged).toBe(false);
    // 1 QA rejection of 6 QA submissions = 16.7%, under 60%; nothing else -> not flagged.
    expect(d.flagged).toBe(false);
    expect(d.overdueInReview.count).toBe(2);

    await http().patch('/performance-metrics/settings').set(auth(f.users.devA)).send({ lateToQaFlagCount: 1 }).expect(403);
  });
});
