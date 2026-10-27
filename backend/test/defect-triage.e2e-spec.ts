import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { isPastEffectiveDue } from '../src/tasks/pm-review';
import { DefectTriageService } from '../src/tasks/defect-triage.service';
import { addBusinessDays, toDateOnlyString } from '../src/common/business-days';

// Defect classification + developer triage, Stage 1 (2026-10-27).
describe('Defect triage (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let moduleId: number;
  let phaseId: number;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const triageRows = (id: number) => ds.query(`SELECT * FROM defect_triages WHERE "taskId" = $1 ORDER BY id`, [id]);
  const dateOnly = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const notified = async (userId: number, type: string, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2 AND link LIKE $3`, [userId, type, `/tasks/${taskId}%`]);
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  const CLASSIFICATION = {
    severity: 'major',
    defectType: 'Functional',
    defectOrigin: 'QA testing (new work)',
    foundInBuild: '2.4.1-rc3',
    foundInEnvironment: 'QA / Test',
  };
  const switchOn = (enabled: boolean, projectId = f.projects.pLms) => patch(f.users.pm, `/defect-triage/projects/${projectId}`, { enabled }).expect(200);
  const createDefect = (body: any = {}) => {
    seq += 1;
    return post(f.users.qaB, '/tasks/defects', {
      projectId: f.projects.pLms,
      moduleId,
      phaseId,
      title: `Triage defect ${seq}`,
      description: '<p>Broken</p>',
      assigneeUserId: f.users.devA.id,
      ...CLASSIFICATION,
      ...body,
    });
  };
  const newPendingDefect = async () => (await createDefect().expect(201)).body.id as number;
  const accept = (id: number, u = f.users.devA) => patch(u, `/defect-triage/tasks/${id}/accept`);
  const dispute = (id: number, body: any = {}, u = f.users.devA) =>
    patch(u, `/defect-triage/tasks/${id}/dispute`, { reason: 'Cannot reproduce', comment: 'Works on my build and on staging', ...body });
  const decide = (id: number, body: any, u = f.users.pm) => patch(u, `/defect-triage/tasks/${id}/decide`, body);
  const submit = (id: number) =>
    post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed</p>', actualHours: 1, artifacts: [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }] });
  const report = async () => (await get(f.users.pm, '/non-compliance-report').expect(200)).body;
  const devRow = (r: any, u: FixtureUser) => r.developers.find((d: any) => d.userId === u.id);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, defect_triages, task_qa_reviews, task_defect_artifacts, user_notifications, audit_logs, team_settings RESTART IDENTITY CASCADE`);
    // Create Defect checks the Project -> Module -> Phase chain.
    moduleId = (
      await ds.query(`INSERT INTO modules ("tenantId", "projectId", "name", "isActive") VALUES ($1, $2, 'Claims', true) RETURNING id`, [f.tenants.t1, f.projects.pLms])
    )[0].id;
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'Claims', 'UAT') RETURNING id`,
        [f.tenants.t1, f.projects.pLms, moduleId],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('switched off (the default)', () => {
    it('a defect is filed as before - classification ignored, no triage', async () => {
      const opts = (await get(f.users.qaB, '/defect-triage/options').expect(200)).body;
      expect(opts.enabledProjectIds).toEqual([]);
      expect(opts.severities).toEqual(['Critical', 'Major', 'Minor', 'Trivial']);
      const res = await createDefect({ severity: 'Nonsense' }).expect(201);
      const row = await taskRow(res.body.id);
      expect(row.triageStatus).toBeNull();
      expect(row.severity).toBeNull();
      expect(await triageRows(res.body.id)).toHaveLength(0);
      await ds.query(`UPDATE project_tasks SET "estimatedHours" = 2, "dueDate" = '2026-12-31' WHERE id = $1`, [res.body.id]);
      await submit(res.body.id).expect(201);
    });
  });

  describe('switch and settings', () => {
    it('only Admin / Program Manager can switch a project or edit the lists', async () => {
      await patch(f.users.devA, `/defect-triage/projects/${f.projects.pLms}`, { enabled: true }).expect(403);
      await get(f.users.qaB, '/defect-triage/settings').expect(403);
      await switchOn(true);
      const page = (await get(f.users.admin, '/defect-triage/settings').expect(200)).body;
      expect(page.projects.find((p: any) => p.id === f.projects.pLms).defectTriageEnabled).toBe(true);
      expect(page.settings.disputeReasons.find((r: any) => r.label === 'Wrong assignee / not my area').notLateTriage).toBe(true);
    });

    it('saves lists trimmed and de-duplicated, keeps at least one item', async () => {
      const page = (await get(f.users.pm, '/defect-triage/settings').expect(200)).body;
      const body = { ...page.settings, severities: [' Blocker ', 'blocker', ...page.settings.severities] };
      const saved = (await patch(f.users.pm, '/defect-triage/settings', body).expect(200)).body;
      expect(saved.severities[0]).toBe('Blocker');
      expect(saved.severities.filter((s: string) => s.toLowerCase() === 'blocker')).toHaveLength(1);
      await patch(f.users.pm, '/defect-triage/settings', { ...page.settings, types: ['  '] }).expect(400);
      await patch(f.users.pm, '/defect-triage/settings', page.settings).expect(200);
    });
  });

  describe('classification at creation', () => {
    it('required fields and list values are enforced', async () => {
      const missing = await createDefect({ severity: '', foundInBuild: '' }).expect(400);
      expect(missing.body.message).toBe('Classification is missing: Severity, Build.');
      const bad = await createDefect({ defectType: 'Cosmic rays' }).expect(400);
      expect(bad.body.message).toContain('"Cosmic rays" is not on the Defect type list');
    });

    it('stores the list text and opens a 1-working-day clock', async () => {
      const id = await newPendingDefect();
      const row = await taskRow(id);
      expect(row.severity).toBe('Major');
      expect(row.foundInBuild).toBe('2.4.1-rc3');
      expect(row.triageStatus).toBe('pending');
      const [t] = await triageRows(id);
      expect(t.assigneeUserId).toBe(f.users.devA.id);
      expect(t.decision).toBeNull();
      expect(dateOnly(t.dueDate)).toBe(toDateOnlyString(addBusinessDays(new Date(t.startedAt), 1)));
    });

    it('a pending defect cannot be submitted for QA', async () => {
      const id = await newPendingDefect();
      await ds.query(`UPDATE project_tasks SET "estimatedHours" = 2, "dueDate" = '2026-12-31' WHERE id = $1`, [id]);
      const res = await submit(id).expect(400);
      expect(res.body.message).toContain('Accept or dispute defect');
    });

    it('a rejection with an unclassified linked defect is refused before anything is saved', async () => {
      const task = (
        await ds.query(
          `INSERT INTO project_tasks ("tenantId","projectId","projectName","moduleId","moduleName","phaseId","phaseName",title,description,status,"estimatedHours","dueDate","assigneeUserId","assigneeEmail","createdByUserId","createdByEmail")
           VALUES ($1,$2,'LMS',$3,'Claims',$4,'UAT','Task to reject','x','Development',2,'2026-12-31',$5,$6,$7,$8) RETURNING id`,
          [f.tenants.t1, f.projects.pLms, moduleId, phaseId, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
        )
      )[0].id;
      await submit(task).expect(201);
      const linked = { title: 'Linked one', description: '<p>x</p>', assigneeUserId: f.users.devA.id };
      await patch(f.users.qaB, `/tasks/${task}/qa-reject`, { comment: 'Fails on save', linkedDefects: [linked] }).expect(400);
      expect((await taskRow(task)).status).toBe('Feedback');
      const ok = await patch(f.users.qaB, `/tasks/${task}/qa-reject`, { comment: 'Fails on save', linkedDefects: [{ ...linked, ...CLASSIFICATION }] }).expect(200);
      const child = await taskRow(ok.body.linkedDefects[0].id);
      expect(child.triageStatus).toBe('pending');
      expect(child.defectOrigin).toBe('QA testing (new work)');
    });
  });

  describe('developer triage', () => {
    it('only the assignee accepts; then it can be submitted', async () => {
      const id = await newPendingDefect();
      await accept(id, f.users.devNone).expect(403);
      await accept(id).expect(200);
      expect((await taskRow(id)).triageStatus).toBe('accepted');
      expect((await triageRows(id))[0].decision).toBe('accepted');
      await accept(id).expect(400);
      await ds.query(`UPDATE project_tasks SET "estimatedHours" = 2, "dueDate" = '2026-12-31' WHERE id = $1`, [id]);
      await submit(id).expect(201);
    });

    it('a dispute needs a reason from the list, a comment, and a ticket for Duplicate', async () => {
      const id = await newPendingDefect();
      await dispute(id, { reason: 'Because' }).expect(400);
      await dispute(id, { comment: 'nope' }).expect(400);
      const dup = await dispute(id, { reason: 'Duplicate' }).expect(400);
      expect(dup.body.message).toContain('needs the number of the ticket');
      await dispute(id, { reason: 'Duplicate', duplicateOfTaskId: 999999 }).expect(400);
    });

    it('a dispute moves it to Disputed, off the clock, to the PM - never a QA rejection', async () => {
      const id = await newPendingDefect();
      await ds.query(`UPDATE project_tasks SET "estimatedHours" = 2, "dueDate" = '2026-01-05' WHERE id = $1`, [id]);
      const res = await dispute(id).expect(200);
      expect(res.body.task.status).toBe('Disputed');
      const row = await taskRow(id);
      expect(isPastEffectiveDue(row, '2026-10-27')).toBe(false);
      expect(await ds.query(`SELECT 1 FROM task_qa_reviews WHERE "taskId" = $1`, [id])).toHaveLength(0);
      await submit(id).expect(400);
      expect(await notified(f.users.pm.id, 'defect.disputed', id)).toBe(true);
      expect(await notified(f.users.qaB.id, 'defect.disputed', id)).toBe(true);
      const queue = (await get(f.users.pm, '/defect-triage/queue').expect(200)).body.items;
      expect(queue.find((q: any) => q.taskId === id).reason).toBe('Cannot reproduce');
      await get(f.users.devA, '/defect-triage/queue').expect(403);
    });
  });

  describe('PM decision', () => {
    const disputed = async (body: any = {}) => {
      const id = await newPendingDefect();
      await dispute(id, body).expect(200);
      // Disputed three working days ago.
      await ds.query(`UPDATE defect_triages SET "decidedAt" = now() - interval '7 days' WHERE "taskId" = $1`, [id]);
      return id;
    };

    it('rejecting the dispute needs a reason and sends it back, accepted, with the days added', async () => {
      const id = await disputed();
      await decide(id, { decision: 'rejected' }).expect(400);
      await decide(id, { decision: 'rejected', comment: 'Reproduced on staging today' }, f.users.devA).expect(403);
      const res = await decide(id, { decision: 'rejected', comment: 'Reproduced on staging today' }).expect(200);
      expect(res.body.task.status).toBe('Development');
      expect(res.body.task.triageStatus).toBe('accepted');
      expect(res.body.task.pmWaitWorkingDays).toBe(5);
      expect(await notified(f.users.devA.id, 'defect.disputeDecided', id)).toBe(true);
      await decide(id, { decision: 'closed' }).expect(400);
    });

    it('agree and close: Closed, remembering Development for a reopen', async () => {
      const id = await disputed();
      const res = await decide(id, { decision: 'closed' }).expect(200);
      expect(res.body.task.status).toBe('Closed');
      expect(res.body.task.priorStatus).toBe('Development');
      expect((await triageRows(id))[0].pmDecision).toBe('closed');
    });

    it('agree and reassign: the new developer gets a fresh clock', async () => {
      const id = await disputed({ reason: 'Wrong assignee / not my area' });
      await decide(id, { decision: 'reassigned' }).expect(400);
      await decide(id, { decision: 'reassigned', assigneeUserId: f.users.devA.id }).expect(400);
      const res = await decide(id, { decision: 'reassigned', assigneeUserId: f.users.devNone.id }).expect(200);
      expect(res.body.task.assigneeUserId).toBe(f.users.devNone.id);
      expect(res.body.task.triageStatus).toBe('pending');
      expect(res.body.task.status).toBe('Development');
      const rows = await triageRows(id);
      expect(rows).toHaveLength(2);
      expect(rows[0].lateExempt).toBe(true);
      expect(rows[0].reassignedToUserId).toBe(f.users.devNone.id);
      expect(rows[1].assigneeUserId).toBe(f.users.devNone.id);
      expect(rows[1].decision).toBeNull();
      await accept(id, f.users.devNone).expect(200);
    });

    it('agree and convert: the defect closes and a Backlog task is created', async () => {
      const id = await disputed({ reason: 'Change request' });
      const res = await decide(id, { decision: 'converted', comment: 'New requirement - plan it' }).expect(200);
      expect(res.body.task.status).toBe('Closed');
      const created = await taskRow(res.body.convertedTaskId);
      expect(created.isDefect).toBe(false);
      expect(created.assigneeUserId).toBeNull();
      expect(created.title).toBe(res.body.task.title);
      expect((await triageRows(id))[0].convertedTaskId).toBe(res.body.convertedTaskId);
    });
  });

  describe('reassignment, switch off, late triage', () => {
    it('reassigning a pending defect supersedes the old clock', async () => {
      const id = await newPendingDefect();
      await patch(f.users.pm, `/tasks/${id}/reassign`, { assigneeUserId: f.users.devNone.id }).expect(200);
      const rows = await triageRows(id);
      expect(rows.map((r: any) => r.decision)).toEqual(['superseded', null]);
      expect(rows[1].assigneeUserId).toBe(f.users.devNone.id);
    });

    it('late triage is reported (info only) and reminded once; exempt reasons and superseded clocks never are', async () => {
      // A clean slate for devA's clocks.
      await ds.query(`UPDATE defect_triages SET decision = 'superseded' WHERE "assigneeUserId" = $1 AND decision IS NULL`, [f.users.devA.id]);
      await ds.query(`UPDATE project_tasks SET "triageStatus" = 'accepted' WHERE "assigneeUserId" = $1 AND "triageStatus" = 'pending'`, [f.users.devA.id]);
      await ds.query(`UPDATE defect_triages SET "lateExempt" = true WHERE "assigneeUserId" = $1`, [f.users.devA.id]);
      await ds.query(`UPDATE defect_triages SET decision = 'superseded' WHERE "assigneeUserId" = $1 AND decision <> 'superseded'`, [f.users.devA.id]);

      const acceptedLate = await newPendingDefect();
      await ds.query(`UPDATE defect_triages SET "dueDate" = '2026-10-05' WHERE "taskId" = $1`, [acceptedLate]);
      await accept(acceptedLate).expect(200);
      const stillWaiting = await newPendingDefect();
      await ds.query(`UPDATE defect_triages SET "dueDate" = '2026-10-05' WHERE "taskId" = $1`, [stillWaiting]);
      const wrongAssignee = await newPendingDefect();
      await ds.query(`UPDATE defect_triages SET "dueDate" = '2026-10-05' WHERE "taskId" = $1`, [wrongAssignee]);
      await dispute(wrongAssignee, { reason: 'Wrong assignee / not my area' }).expect(200);

      const dev = devRow(await report(), f.users.devA);
      expect(dev.lateTriage.items.map((i: any) => i.taskId).sort()).toEqual([acceptedLate, stillWaiting].sort());
      expect(dev.lateTriage.items.find((i: any) => i.taskId === stillWaiting).decision).toBeNull();
      expect(dev.disputes.waiting).toBeGreaterThanOrEqual(1);

      const triage = app.get(DefectTriageService);
      const sent = await triage.remindOverdue(new Date());
      expect(sent).toContain(stillWaiting);
      expect(sent).not.toContain(acceptedLate);
      expect(await notified(f.users.devA.id, 'defect.triageOverdue', stillWaiting)).toBe(true);
      expect(await triage.remindOverdue(new Date())).not.toContain(stillWaiting);

      const mine = (await get(f.users.devA, '/defect-triage/mine').expect(200)).body;
      expect(mine.find((m: any) => m.id === stillWaiting).late).toBe(true);
    });

    it('switching off releases defects waiting for triage', async () => {
      const id = await newPendingDefect();
      await switchOn(false);
      expect((await taskRow(id)).triageStatus).toBeNull();
      expect((await triageRows(id))[0].decision).toBe('superseded');
      const state = (await get(f.users.devA, `/defect-triage/tasks/${id}`).expect(200)).body;
      expect(state.canAccept).toBe(false);
      await switchOn(true);
    });
  });

  describe('classification edits', () => {
    it('the raising QA or a PM can correct it; the developer cannot', async () => {
      const id = await newPendingDefect();
      await patch(f.users.devA, `/defect-triage/tasks/${id}/classification`, { ...CLASSIFICATION, severity: 'Minor' }).expect(403);
      const res = await patch(f.users.qaB, `/defect-triage/tasks/${id}/classification`, { ...CLASSIFICATION, severity: 'minor' }).expect(200);
      expect(res.body.task.severity).toBe('Minor');
      await patch(f.users.pm, `/defect-triage/tasks/${id}/classification`, { ...CLASSIFICATION, severity: '' }).expect(400);
    });
  });
});
