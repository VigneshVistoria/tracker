import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { DEFAULT_QA_TEST_FAILED_REASONS, QA_INTAKE_AUDIT, notReadyDependencyExempt, protects } from '../src/tasks/qa-intake';

// Performance Tracking S4 (2026-10-28): QA intake + reopen after Pass.
// OFF = nothing changes. ON = QA picks one Test failed reason (Peer Review
// none); the developer answers "dependencies met?" at submission (may
// submit with "No"); Not ready because of a dependency is exempt from Q1
// only if a picked dependency was recorded before the submission and is
// owned by someone else; PM/Admin reopen a passed task with a reason and a
// new proposed date - kept in task_reopens, counted on the task, logged in
// the status log, charged to the developer whose submission passed.
describe('QA intake + reopen after Pass (Performance Tracking S4, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const latestRound = async (id: number) => (await ds.query(`SELECT * FROM task_qa_reviews WHERE "taskId" = $1 ORDER BY id DESC LIMIT 1`, [id]))[0];
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const audits = (id: number, action: string) =>
    ds.query(`SELECT * FROM audit_logs WHERE "entityType" = 'ProjectTask' AND "entityId" = $1 AND action = $2 ORDER BY id`, [id, action]);
  const notified = async (userId: number, type: string, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2 AND link = $3`, [userId, type, `/tasks/${taskId}`]);
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const setTracking = (enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${f.projects.pLms}`, { enabled }).expect(200);

  const newTask = async (values: Record<string, any> = {}) => {
    seq += 1;
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pLms,
      projectName: 'LMS',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'UAT',
      title: `Intake ticket ${seq}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
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
    return res[0].id as number;
  };
  const PR = { type: 'Pull Request Link', url: 'https://example.com/pr/1' };
  const MET = { met: true };
  const submit = (id: number, body: any = {}) =>
    post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed the date check</p>', actualHours: 2, artifacts: [PR], ...body });
  const reject = (id: number, body: any = {}) => patch(f.users.qaB, `/tasks/${id}/qa-reject`, { comment: '<p>Still broken on save</p>', ...body });
  const notReady = (id: number, reason: string) =>
    patch(f.users.qaB, `/tasks/${id}/qa-not-ready`, { reason, comment: '<p>Waiting for the payment sandbox</p>' });
  const approve = (id: number) => patch(f.users.qaB, `/tasks/${id}/qa-approve`, {});
  const reopen = (u: FixtureUser, id: number, body: any = {}) =>
    post(u, `/tasks/${id}/reopen-after-pass`, { reason: 'Same save bug is back on production', dueDate: '2026-12-20', ...body });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_flags, task_dependency_tickets, task_reopens, audit_logs, team_settings, user_notifications RESTART IDENTITY CASCADE`,
    );
    await ds.query(`UPDATE projects SET "submissionChecklistEnabled" = false, "pmReviewEnabled" = false`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'Medical Claim', 'UAT') RETURNING id`,
        [f.tenants.t1, f.projects.pLms, f.modules.mA],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('protection: recorded before submission AND owned by someone else - nothing else', () => {
    const submitted = new Date('2026-11-02T10:00:00Z');
    const before = new Date('2026-11-01T10:00:00Z');
    expect(protects({ ownerUserId: 7, ownerExternal: null, recordedAt: before }, 5, submitted)).toBe(true);
    expect(protects({ ownerUserId: null, ownerExternal: 'Client IT', recordedAt: before }, 5, submitted)).toBe(true);
    // Their own.
    expect(protects({ ownerUserId: 5, ownerExternal: null, recordedAt: before }, 5, submitted)).toBe(false);
    // Recorded only at (or after) the submission.
    expect(protects({ ownerUserId: 7, ownerExternal: null, recordedAt: submitted }, 5, submitted)).toBe(false);
    const decl = (p: boolean, met = false) => ({ met, waitingOn: null, declared: [{ kind: 'blocker' as const, id: 1, title: 'x', ownerUserId: 7, ownerExternal: null, recordedAt: '', protects: p }], declaredAt: '', submittedByUserId: 5 });
    expect(notReadyDependencyExempt(true, decl(true))).toBe(true);
    expect(notReadyDependencyExempt(true, decl(false))).toBe(false);
    expect(notReadyDependencyExempt(false, decl(true))).toBe(false);
    expect(notReadyDependencyExempt(true, null)).toBe(false);
  });

  it('the status log action list includes the reopen (latest SQL definition)', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-tracking-qa-intake.sql'), 'utf8');
    expect(sql).toContain("'task_reopened_after_pass'");
  });

  describe('switch OFF - nothing changes', () => {
    beforeAll(() => setTracking(false));

    it('no reason, no declaration, no reopen', async () => {
      const id = await newTask();
      expect((await get(f.users.devA, `/tasks/${id}/qa-intake`).expect(200)).body).toEqual({ trackingOn: false, testFailedReasons: [], recordedDependencies: [] });
      await submit(id).expect(201);
      expect((await latestRound(id)).dependencyDeclaration).toBeNull();
      await reject(id).expect(200);
      expect((await latestRound(id)).testFailedReason).toBeNull();
      const passed = await newTask();
      await submit(passed).expect(201);
      await approve(passed).expect(200);
      await reopen(f.users.pm, passed).expect(400);
    });
  });

  describe('switch ON', () => {
    beforeAll(() => setTracking(true));

    it('QA must pick one Test failed reason from the editable list; it is stored as text', async () => {
      const id = await newTask();
      await submit(id).expect(400); // the declaration is required now
      await submit(id, { dependencies: MET }).expect(201);
      expect((await get(f.users.qaB, `/tasks/${id}/qa-intake`).expect(200)).body.testFailedReasons).toEqual(DEFAULT_QA_TEST_FAILED_REASONS);
      await reject(id).expect(400);
      await reject(id, { reason: 'Not on the list' }).expect(400);
      await reject(id, { reason: 'Requirement not met' }).expect(200);
      expect((await latestRound(id)).testFailedReason).toBe('Requirement not met');
      // Admin / PM edit the list; QA cannot.
      await patch(f.users.qaB, '/qa-review/test-failed-reasons', { reasons: ['x'] }).expect(403);
      const saved = (await patch(f.users.pm, '/qa-review/test-failed-reasons', { reasons: ['Fix does not work', ' Wrong scope ', 'wrong scope'] }).expect(200)).body;
      expect(saved.reasons).toEqual(['Fix does not work', 'Wrong scope']);
      expect((await get(f.users.qaB, '/qa-review/test-failed-reasons').expect(200)).body.reasons).toEqual(['Fix does not work', 'Wrong scope']);
      await patch(f.users.admin, '/qa-review/test-failed-reasons', { reasons: DEFAULT_QA_TEST_FAILED_REASONS }).expect(200);
    });

    it('"No, still waiting on..." can be submitted; the round keeps what was declared', async () => {
      const id = await newTask();
      await submit(id, { dependencies: { met: false } }).expect(400); // must say what
      await submit(id, { dependencies: { met: false, waitingOnDependencies: [{ kind: 'blocker', id: 999 }] } }).expect(400);
      await submit(id, { dependencies: { met: false, waitingOn: 'The payment sandbox keys' } }).expect(201);
      expect((await latestRound(id)).dependencyDeclaration).toMatchObject({ met: false, waitingOn: 'The payment sandbox keys', declared: [] });
    });

    it('Not ready because of a dependency recorded BEFORE submission and owned by someone else is exempt from Q1', async () => {
      const id = await newTask();
      // A blocker owned by devNone, recorded before the submission.
      await post(f.users.devA, '/task-flags', { taskId: id, kind: 'blocker', reason: 'Waiting on the payment sandbox keys', blockingOwnerUserId: f.users.devNone.id }).expect(201);
      const [flag] = await ds.query(`SELECT id FROM task_flags WHERE "taskId" = $1`, [id]);
      const recorded = (await get(f.users.devA, `/tasks/${id}/qa-intake`).expect(200)).body.recordedDependencies;
      expect(recorded).toEqual([expect.objectContaining({ kind: 'blocker', id: flag.id, ownerUserId: f.users.devNone.id })]);
      // Back-date the flag a little so "before" is unambiguous.
      await ds.query(`UPDATE task_flags SET "setAt" = now() - interval '1 hour' WHERE id = $1`, [flag.id]);
      await submit(id, { dependencies: { met: false, waitingOnDependencies: [{ kind: 'blocker', id: flag.id }] } }).expect(201);
      expect((await latestRound(id)).dependencyDeclaration.declared[0]).toMatchObject({ kind: 'blocker', protects: true });
      await notReady(id, 'Blocked by a dependency').expect(200);
      expect((await latestRound(id)).dependencyExempt).toBe(true);
    });

    it('the dependency reason keys on its fixed code: renaming the label keeps the exemption; it cannot be deleted', async () => {
      const url = '/qa-review/not-ready-reasons';
      const before = (await get(f.users.pm, url).expect(200)).body;
      expect(before.dependencyReason).toBe('Blocked by a dependency');
      // Rename it.
      const renamed = before.reasons.map((r: string) => (r === 'Blocked by a dependency' ? 'Waiting on another team' : r));
      const saved = (await patch(f.users.pm, url, { reasons: renamed, dependencyReason: 'Waiting on another team' }).expect(200)).body;
      expect(saved.dependencyReason).toBe('Waiting on another team');
      const [row] = await ds.query(`SELECT "qaNotReadyReasons" FROM team_settings WHERE "tenantId" = $1`, [f.tenants.t1]);
      expect(row.qaNotReadyReasons).toContainEqual({ label: 'Waiting on another team', code: 'blocked_by_dependency' });
      // Reordering / other edits keep it without naming it again.
      await patch(f.users.pm, url, { reasons: [...renamed].reverse() }).expect(200);
      expect((await get(f.users.qaB, url).expect(200)).body.dependencyReason).toBe('Waiting on another team');
      // It cannot be removed.
      await patch(f.users.pm, url, { reasons: renamed.filter((r: string) => r !== 'Waiting on another team') }).expect(400);

      // A Not ready with the renamed label is still exempt.
      const id = await newTask();
      await post(f.users.devA, '/task-flags', { taskId: id, kind: 'blocker', reason: 'Waiting on the payment sandbox keys', blockingOwnerUserId: f.users.devNone.id }).expect(201);
      const [flag] = await ds.query(`SELECT id FROM task_flags WHERE "taskId" = $1`, [id]);
      await ds.query(`UPDATE task_flags SET "setAt" = now() - interval '1 hour' WHERE id = $1`, [flag.id]);
      await submit(id, { dependencies: { met: false, waitingOnDependencies: [{ kind: 'blocker', id: flag.id }] } }).expect(201);
      await notReady(id, 'Waiting on another team').expect(200);
      expect((await latestRound(id)).dependencyExempt).toBe(true);
      // The old label is no longer a reason at all.
      const other = await newTask();
      await submit(other, { dependencies: MET }).expect(201);
      await notReady(other, 'Blocked by a dependency').expect(400);

      // Back to the default label for the other tests.
      await patch(f.users.pm, url, { reasons: before.reasons, dependencyReason: 'Blocked by a dependency' }).expect(200);
    });

    it('no protection: named only in the text, or not ready for another reason', async () => {
      const textOnly = await newTask();
      await submit(textOnly, { dependencies: { met: false, waitingOn: 'Client test accounts' } }).expect(201);
      await notReady(textOnly, 'Blocked by a dependency').expect(200);
      expect((await latestRound(textOnly)).dependencyExempt).toBe(false);

      const other = await newTask();
      await submit(other, { dependencies: MET }).expect(201);
      await notReady(other, 'Build not deployed').expect(200);
      expect((await latestRound(other)).dependencyExempt).toBeNull();
    });

    it('an outside party (external blocker) counts as someone else', async () => {
      const id = await newTask();
      await post(f.users.devA, '/task-flags', { taskId: id, kind: 'blocker', reason: 'Waiting on the client IT team', blockingOwnerExternal: 'Client IT' }).expect(201);
      const [flag] = await ds.query(`SELECT id FROM task_flags WHERE "taskId" = $1`, [id]);
      await ds.query(`UPDATE task_flags SET "setAt" = now() - interval '1 hour' WHERE id = $1`, [flag.id]);
      await submit(id, { dependencies: { met: false, waitingOnDependencies: [{ kind: 'blocker', id: flag.id }] } }).expect(201);
      expect((await latestRound(id)).dependencyDeclaration.declared[0]).toMatchObject({ ownerExternal: 'Client IT', protects: true });
    });

    it('with the PM review gate on, the declaration made at submission reaches the QA round', async () => {
      await ds.query(`UPDATE projects SET "pmReviewEnabled" = true WHERE id = $1`, [f.projects.pLms]);
      const id = await newTask();
      await submit(id, { dependencies: { met: false, waitingOn: 'Payment sandbox' } }).expect(201);
      expect((await latestRound(id)).reviewType).toBe('pm');
      await patch(f.users.pm, `/pm-review/tasks/${id}/send-to-qa`, {}).expect(200);
      const qaRound = await latestRound(id);
      expect(qaRound).toMatchObject({ reviewType: 'qa', dependencyDeclaration: expect.objectContaining({ met: false, waitingOn: 'Payment sandbox' }) });
      await ds.query(`UPDATE projects SET "pmReviewEnabled" = false WHERE id = $1`, [f.projects.pLms]);
    });

    describe('reopen after Pass', () => {
      it('PM/Admin only, reason and a new date required; back to Development; counted, kept and logged', async () => {
        const id = await newTask();
        await submit(id, { dependencies: MET }).expect(201);
        await approve(id).expect(200);
        expect((await taskRow(id)).status).toBe('Pass');
        // The developer whose submission passed - then reassigned.
        await ds.query(`UPDATE project_tasks SET "assigneeUserId" = $2, "assigneeEmail" = $3 WHERE id = $1`, [id, f.users.devNone.id, f.users.devNone.email]);

        await reopen(f.users.devA, id).expect(403);
        await reopen(f.users.qaB, id).expect(403);
        await reopen(f.users.pm, id, { reason: 'short' }).expect(400);
        await reopen(f.users.pm, id, { dueDate: '2020-01-01' }).expect(400);
        const res = (await reopen(f.users.pm, id).expect(201)).body;
        expect(res.task).toMatchObject({ status: 'Development', reopenCount: 1, dueDate: '2026-12-20', completedAt: null, dueDateCommittedByUserId: null });

        const [row] = await ds.query(`SELECT * FROM task_reopens WHERE "taskId" = $1`, [id]);
        expect(row).toMatchObject({ fromStatus: 'Pass', reopenedByUserId: f.users.pm.id, chargedUserId: f.users.devA.id, assigneeUserId: f.users.devNone.id });
        expect(row.passedAt).toBeTruthy();
        expect(await audits(id, QA_INTAKE_AUDIT.REOPENED_AFTER_PASS)).toHaveLength(1);
        // The status log records it as a reopen, whatever the status name.
        const [ev] = await ds.query(`SELECT * FROM task_status_events WHERE "taskId" = $1 ORDER BY id DESC LIMIT 1`, [id]);
        expect(ev).toMatchObject({ fromStatus: 'Pass', toStatus: 'Development', action: 'task_reopened_after_pass', actorUserId: f.users.pm.id });
        // The proposal is in the date-history log, as a PM change.
        const [due] = await ds.query(`SELECT kind, "actorUserId" FROM task_commitment_events WHERE "taskId" = $1 ORDER BY id DESC LIMIT 1`, [id]);
        expect(due).toMatchObject({ kind: 'due_changed', actorUserId: f.users.pm.id });
        expect(await notified(f.users.devNone.id, 'task.reopenedAfterPass', id)).toBe(true);
        expect(await notified(f.users.qaB.id, 'task.reopenedAfterPass', id)).toBe(true);
        // Not from Development.
        await reopen(f.users.admin, id).expect(400);
        expect((await get(f.users.pm, `/tasks/${id}/reopens`).expect(200)).body).toHaveLength(1);
      });

      it('the reopened task can be submitted and passed again; Admin can reopen it a second time', async () => {
        const id = await newTask();
        await submit(id, { dependencies: MET }).expect(201);
        await approve(id).expect(200);
        await reopen(f.users.pm, id).expect(201);
        // Before the reopen this would be "already approved".
        await submit(id, { dependencies: MET }).expect(201);
        await approve(id).expect(200);
        await reopen(f.users.admin, id, { dueDate: '2026-12-22' }).expect(201);
        expect((await taskRow(id)).reopenCount).toBe(2);
      });

      it('from a Released status too', async () => {
        const id = await newTask({ status: 'Released - With Showstoppers' });
        await reopen(f.users.pm, id).expect(201);
        const [row] = await ds.query(`SELECT * FROM task_reopens WHERE "taskId" = $1`, [id]);
        expect(row).toMatchObject({ fromStatus: 'Released - With Showstoppers', chargedUserId: null });
      });
    });
  });
});
