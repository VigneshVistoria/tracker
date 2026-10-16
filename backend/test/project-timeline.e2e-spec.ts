import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { addDays } from '../src/project-timeline/project-timeline-rules';
import { dateInZone } from '../src/team-settings/time-zone';

// Project Timeline (2026-10-16): PM and Admin import and edit, Executive
// views, everyone else 403, logged out 401. Nothing is saved by parse or
// preview; import and Save changes write one audit row per row changed.
describe('Project Timeline (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let pA: number;

  const SAMPLE = fs.readFileSync(path.resolve(__dirname, 'fixtures/project-timeline-sample.csv')).toString('base64');
  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const rowCount = async () => Number((await ds.query(`SELECT count(*) FROM project_timeline_rows WHERE "projectId" = $1`, [pA]))[0].count);
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const parseSample = async (u = f.users.pm) => (await post(u, '/project-timeline/import/parse', { format: 'csv', fileBase64: SAMPLE }).expect(201)).body.rows;
  const plan = async (u = f.users.pm) => (await get(u, `/project-timeline/projects/${pA}`).expect(200)).body;

  beforeAll(async () => {
    ({ app, dataSource: ds, tokenFor } = await createTestApp());
  });

  beforeEach(async () => {
    f = await seedFixtures(ds);
    pA = f.projects.pA;
    await ds.query(`TRUNCATE "audit_logs" RESTART IDENTITY`);
    await ds.query(`INSERT INTO project_timeline_teams ("tenantId", name) VALUES ($1, 'Amanah'), ($1, 'Vistoria'), ($2, 'Other Tenant Team')`, [
      f.tenants.t1,
      f.tenants.t2,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    const routes = (projectId: () => number) => [
      { method: 'get', url: () => '/project-timeline/projects', edit: false },
      { method: 'get', url: () => `/project-timeline/projects/${projectId()}`, edit: false },
      { method: 'get', url: () => '/project-timeline/teams', edit: false },
      { method: 'post', url: () => '/project-timeline/teams', edit: true },
      { method: 'get', url: () => '/project-timeline/template?format=csv', edit: true },
      { method: 'post', url: () => '/project-timeline/import/parse', edit: true },
      { method: 'post', url: () => `/project-timeline/projects/${projectId()}/import/preview`, edit: true },
      { method: 'post', url: () => `/project-timeline/projects/${projectId()}/import`, edit: true },
      { method: 'post', url: () => `/project-timeline/projects/${projectId()}/changes`, edit: true },
    ];

    it('401 on every route without a login', async () => {
      for (const r of routes(() => pA)) await (http() as any)[r.method](r.url()).send({}).expect(401);
    });

    it('403 on every route for Developer, QA and Client', async () => {
      for (const u of [f.users.devA, f.users.qaB, f.users.clientA]) {
        for (const r of routes(() => pA)) {
          const res = await (http() as any)[r.method](r.url()).set(auth(u)).send({});
          expect([r.url(), u.role, res.status]).toEqual([r.url(), u.role, 403]);
        }
      }
    });

    it('Executive can view but never change anything', async () => {
      for (const r of routes(() => pA)) {
        const res = await (http() as any)[r.method](r.url()).set(auth(f.users.exec)).send({ format: 'csv', fileBase64: SAMPLE, rows: [], name: 'X' });
        expect([r.url(), res.status]).toEqual([r.url(), r.edit ? 403 : 200]);
      }
      expect(await rowCount()).toBe(0);
      expect(await audits('project_timeline_team_created')).toHaveLength(0);
    });

    it('Admin and PM can do everything', async () => {
      for (const u of [f.users.pm, f.users.admin]) {
        const rows = await parseSample(u);
        await post(u, `/project-timeline/projects/${pA}/import/preview`, { rows }).expect(201);
        await get(u, '/project-timeline/template?format=xlsx').expect(200);
      }
    });

    it("never shows another tenant's project or teams", async () => {
      await get(f.users.pmT2, `/project-timeline/projects/${pA}`).expect(404);
      await post(f.users.pmT2, `/project-timeline/projects/${pA}/import`, { rows: [] }).expect(404);
      const teams = (await get(f.users.pm, '/project-timeline/teams').expect(200)).body.map((t: any) => t.name);
      expect(teams).toEqual(['Amanah', 'Vistoria']);
      const projects = (await get(f.users.pmT2, '/project-timeline/projects').expect(200)).body.map((p: any) => p.name);
      expect(projects).toEqual(['Tenant Two Project']);
    });
  });

  describe('import', () => {
    it('parse and preview save nothing', async () => {
      const rows = await parseSample();
      expect(rows).toHaveLength(16);
      const preview = (await post(f.users.pm, `/project-timeline/projects/${pA}/import/preview`, { rows }).expect(201)).body;
      expect(preview.summary).toEqual(expect.objectContaining({ totalRows: 16, modules: 3, errorRows: 5, toImport: 11 }));
      expect(await rowCount()).toBe(0);
      expect(Number((await ds.query(`SELECT count(*) FROM audit_logs`))[0].count)).toBe(0);
    });

    it('refuses a file with missing columns, naming them', async () => {
      const csv = Buffer.from('Module,Phase,Status\nA,B,To Do\n').toString('base64');
      const res = await post(f.users.pm, '/project-timeline/import/parse', { format: 'csv', fileBase64: csv }).expect(400);
      expect(res.body.message).toContain('Team, Start Date, End Date');
    });

    it('imports only ticked, error-free rows, with accepted fixes, and audits each one', async () => {
      const rows = await parseSample();
      // The PM accepts the team suggestion on row 13 and the typo fix on row 6, and unticks row 16.
      const fixed = rows.map((r: any) => {
        if (r.rowNumber === 13) return { ...r, team: 'Amanah' };
        if (r.rowNumber === 6) return { ...r, phase: 'Data Migration Rehearsal' };
        if (r.rowNumber === 17) return { ...r, include: false };
        return r;
      });
      const res = (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: fixed }).expect(201)).body;
      expect(res).toEqual(expect.objectContaining({ created: 10, updated: 0, skipped: 5, unticked: 1, teamsCreated: [] }));
      expect(res.skippedRows.map((s: any) => s.rowNumber)).toEqual([7, 10, 11, 12, 14]);
      expect(await rowCount()).toBe(10);

      const saved = res.plan.rows;
      expect(saved.map((r: any) => r.phase)).toContain('Data Migration Rehearsal');
      expect(saved.find((r: any) => r.phase === 'Data Migration')).toEqual(
        expect.objectContaining({ module: 'Medical Claim', teamName: 'Vistoria', status: 'To Do', startDate: '2026-07-13', endDate: '2026-07-24', version: 1 }),
      );
      expect(saved.find((r: any) => r.phase === 'Training').teamName).toBe('Amanah');

      const created = await audits('project_timeline_row_created');
      expect(created).toHaveLength(10);
      expect(created[0]).toEqual(expect.objectContaining({ userId: f.users.pm.id, userEmail: f.users.pm.email, userRole: 'program_manager', entityType: 'ProjectTimelineRow' }));
      expect(JSON.parse(created[0].details)).toEqual(
        expect.objectContaining({ source: 'import', rowNumber: 2, values: expect.objectContaining({ module: 'Medical Claim', phase: 'Requirements Gathering', team: 'Vistoria' }) }),
      );
      const imported = await audits('project_timeline_imported');
      expect(imported).toHaveLength(1);
      expect(JSON.parse(imported[0].details)).toEqual(expect.objectContaining({ created: 10, skipped: 5, totalRows: 16 }));
    });

    it('adds an unknown team to the list only when the row is imported', async () => {
      const res = (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: await parseSample() }).expect(201)).body;
      expect(res.teamsCreated).toEqual(['Amanha']);
      expect(res.plan.teams.map((t: any) => t.name)).toEqual(['Amanah', 'Amanha', 'Vistoria']);
      expect(await audits('project_timeline_team_created')).toHaveLength(1);
    });

    it('re-uploading matches on Project + Module + Phase and never duplicates', async () => {
      const rows = await parseSample();
      await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows }).expect(201);
      const again = (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows }).expect(201)).body;
      expect(again).toEqual(expect.objectContaining({ created: 0, updated: 0, unchanged: 11 }));
      expect(await rowCount()).toBe(11);
      expect(await audits('project_timeline_imported')).toHaveLength(1); // nothing changed, nothing logged

      // One status changed in the file, one row dropped from it.
      const changed = rows
        .filter((r: any) => r.rowNumber !== 15)
        .map((r: any) => (r.rowNumber === 3 ? { ...r, status: 'In Progress', phase: 'data migration' } : r));
      const preview = (await post(f.users.pm, `/project-timeline/projects/${pA}/import/preview`, { rows: changed }).expect(201)).body;
      expect(preview.summary).toEqual(expect.objectContaining({ newRows: 0, changedRows: 1, unchangedRows: 9, missingRows: 1 }));
      expect(preview.missing[0].phase).toBe('Design');

      // Deleting a row that the file still has is refused.
      const keptId = preview.rows.find((r: any) => r.rowNumber === 2).existingId;
      await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: changed, deleteIds: [keptId] }).expect(400);

      const res = (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: changed, deleteIds: [preview.missing[0].id] }).expect(201)).body;
      expect(res).toEqual(expect.objectContaining({ created: 0, updated: 1, deleted: 1 }));
      expect(await rowCount()).toBe(10);
      const [update] = await audits('project_timeline_row_updated');
      expect(JSON.parse(update.details).changes).toEqual({
        phase: { old: 'Data Migration', new: 'data migration' },
        status: { old: 'To Do', new: 'In Progress' },
      });
      const [deleted] = await audits('project_timeline_row_deleted');
      expect(JSON.parse(deleted.details).snapshot).toEqual(expect.objectContaining({ module: 'Pre-Auth', phase: 'Design', status: 'Completed' }));
    });
  });

  describe('save changes', () => {
    const importSample = async () => (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: await parseSample() }).expect(201)).body.plan;
    const save = (u: FixtureUser, body: any) => post(u, `/project-timeline/projects/${pA}/changes`, body);

    it('edits every column, bumps the version and audits old and new values', async () => {
      const { rows, teams } = await importSample();
      const row = rows.find((r: any) => r.phase === 'Data Migration');
      const amanah = teams.find((t: any) => t.name === 'Amanah');
      const res = (
        await save(f.users.admin, {
          updates: [{ id: row.id, version: row.version, module: 'Medical  Claims ', phase: 'Data Load', teamId: amanah.id, status: 'Delayed', startDate: '2026-07-14', endDate: '2026-07-30' }],
        }).expect(201)
      ).body;
      const after = res.rows.find((r: any) => r.id === row.id);
      expect(after).toEqual(
        expect.objectContaining({ module: 'Medical Claims', phase: 'Data Load', teamName: 'Amanah', status: 'Delayed', startDate: '2026-07-14', endDate: '2026-07-30', version: 2 }),
      );
      const [audit] = await audits('project_timeline_row_updated');
      expect(audit).toEqual(expect.objectContaining({ userId: f.users.admin.id, userRole: 'admin', entityId: row.id }));
      expect(JSON.parse(audit.details)).toEqual(
        expect.objectContaining({
          source: 'edit',
          changes: {
            module: { old: 'Medical Claim', new: 'Medical Claims' },
            phase: { old: 'Data Migration', new: 'Data Load' },
            team: { old: 'Vistoria', new: 'Amanah' },
            status: { old: 'To Do', new: 'Delayed' },
            startDate: { old: '2026-07-13', new: '2026-07-14' },
            endDate: { old: '2026-07-24', new: '2026-07-30' },
          },
        }),
      );
    });

    it("refuses to overwrite someone else's newer change, saving nothing", async () => {
      const { rows } = await importSample();
      const [a, b] = rows;
      await save(f.users.pm, { updates: [{ id: a.id, version: a.version, status: 'Delayed' }] }).expect(201);
      const res = await save(f.users.admin, {
        updates: [
          { id: a.id, version: a.version, status: 'On Hold' },
          { id: b.id, version: b.version, status: 'On Hold' },
        ],
      }).expect(409);
      expect(res.body.message).toContain('was changed by someone else');
      const now = (await plan()).rows;
      expect(now.find((r: any) => r.id === a.id)).toEqual(expect.objectContaining({ status: 'Delayed', version: 2 }));
      expect(now.find((r: any) => r.id === b.id).status).toBe(b.status);
    });

    it('blocks end before start, empty names, unknown teams and duplicates', async () => {
      const { rows } = await importSample();
      const [a, b] = rows;
      const bad = async (body: any, text: string) => expect((await save(f.users.pm, body).expect(400)).body.message).toContain(text);
      await bad({ updates: [{ id: a.id, version: 1, startDate: '2026-08-10', endDate: '2026-08-01' }] }, 'is before the start date');
      await bad({ updates: [{ id: a.id, version: 1, phase: '   ' }] }, 'Phase is empty');
      await bad({ updates: [{ id: a.id, version: 1, teamId: 999999 }] }, "that team doesn't exist");
      await bad({ updates: [{ id: a.id, version: 1, startDate: '2026-02-31' }] }, 'is not a real date');
      await bad({ updates: [{ id: b.id, version: 1, module: a.module, phase: ` ${a.phase.toUpperCase()} ` }] }, 'would appear twice');
      await bad({ creates: [{ module: a.module, phase: a.phase, status: 'To Do' }] }, 'would appear twice');
      await save(f.users.pm, { updates: [{ id: a.id, version: 1, status: 'Finished' }] }).expect(400);
      expect(await audits('project_timeline_row_updated')).toHaveLength(0);
    });

    it('adds, duplicates, deletes and reorders in one save; can swap two names', async () => {
      const { rows } = await importSample();
      const [a, b, c] = rows;
      const res = (
        await save(f.users.pm, {
          creates: [
            { tempId: 'n1', module: 'Medical Claim', phase: 'Hypercare', status: 'To Do', startDate: '2026-12-01', endDate: '2026-12-15', sortOrder: 50 },
            { tempId: 'n2', module: a.module, phase: `${a.phase} (copy)`, teamId: a.teamId, status: a.status, startDate: a.startDate, endDate: a.endDate, sortOrder: 51 },
          ],
          updates: [
            { id: a.id, version: 1, phase: b.phase, sortOrder: b.sortOrder },
            { id: b.id, version: 1, phase: a.phase, sortOrder: a.sortOrder },
          ],
          deletes: [{ id: c.id, version: 1 }],
        }).expect(201)
      ).body;
      expect(res.rows).toHaveLength(12);
      expect(res.rows.find((r: any) => r.id === a.id).phase).toBe(b.phase);
      expect(res.rows.find((r: any) => r.id === b.id).phase).toBe(a.phase);
      expect(res.rows.some((r: any) => r.id === c.id)).toBe(false);
      expect(await audits('project_timeline_row_created')).toHaveLength(11 + 2);
      expect(await audits('project_timeline_row_deleted')).toHaveLength(1);
      const swapped = JSON.parse((await audits('project_timeline_row_updated'))[0].details).changes;
      expect(Object.keys(swapped)).toEqual(['phase', 'order']);
    });

    it('a save that changes nothing writes no audit rows', async () => {
      const { rows } = await importSample();
      await save(f.users.pm, { updates: [{ id: rows[0].id, version: 1, status: rows[0].status }] }).expect(201);
      expect(await audits('project_timeline_row_updated')).toHaveLength(0);
      expect((await plan()).rows[0].version).toBe(1);
    });
  });

  it('counts overdue as To Do with an end date before today in the team time zone', async () => {
    const today = dateInZone(new Date(), 'Africa/Addis_Ababa');
    const csv = [
      'Module,Phase,Team,Status,Start Date,End Date',
      `M,Past To Do,,To Do,,${addDays(today, -1)}`,
      `M,Today To Do,,To Do,,${today}`,
      `M,Past Delayed,,Delayed,,${addDays(today, -1)}`,
      `M,Past In Progress,,In Progress,,${addDays(today, -1)}`,
      `M,Past On Hold,,On Hold,,${addDays(today, -1)}`,
      'M,No End,,To Do,,',
    ].join('\n');
    const rows = (await post(f.users.pm, '/project-timeline/import/parse', { format: 'csv', fileBase64: Buffer.from(csv).toString('base64') }).expect(201)).body.rows;
    await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows }).expect(201);
    const { summary, today: serverToday, timeZone } = await plan(f.users.exec);
    expect([serverToday, timeZone]).toEqual([today, 'Africa/Addis_Ababa']);
    expect(summary.overdue).toBe(1);
    expect(summary.delayed).toBe(1);
    expect(summary.delayedPastEnd.map((r: any) => r.phase)).toEqual(['Past Delayed']);
    expect(summary.inProgressPastEnd.map((r: any) => r.phase)).toEqual(['Past In Progress']);
  });

  describe('teams and template', () => {
    it('adds a team once (case-insensitive) and audits it', async () => {
      const team = (await post(f.users.admin, '/project-timeline/teams', { name: '  Ops   Team ' }).expect(201)).body;
      expect(team.name).toBe('Ops Team');
      await post(f.users.pm, '/project-timeline/teams', { name: 'ops team' }).expect(409);
      await post(f.users.pm, '/project-timeline/teams', { name: '' }).expect(400);
      expect(await audits('project_timeline_team_created')).toHaveLength(1);
    });

    it.each(['csv', 'xlsx'] as const)('the %s template reads back through the importer', async (format) => {
      const res = await get(f.users.pm, `/project-timeline/template?format=${format}`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      const rows = (await post(f.users.pm, '/project-timeline/import/parse', { format, fileBase64: (res.body as Buffer).toString('base64') }).expect(201)).body.rows;
      expect(rows).toHaveLength(2);
      const preview = (await post(f.users.pm, `/project-timeline/projects/${pA}/import/preview`, { rows }).expect(201)).body;
      expect(preview.summary).toEqual(expect.objectContaining({ errorRows: 0, toImport: 2 }));
    });
  });

  describe('slip tracking and baseline reset', () => {
    const importSample = async () => (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: await parseSample() }).expect(201)).body.plan;
    const slip = async (u = f.users.pm) => (await get(u, `/project-timeline/projects/${pA}/slip`).expect(200)).body;
    const byPhase = async (plan: any) => new Map(plan.rows.map((r: any) => [r.phase, r]));
    const resetUrl = () => `/project-timeline/projects/${pA}/baseline/reset`;

    it('401 logged out; slip is view-only (Exec 200, Dev/QA/Client 403); reset is PM only', async () => {
      await http().get(`/project-timeline/projects/${pA}/slip`).expect(401);
      await http().post(resetUrl()).send({ reason: 'x' }).expect(401);
      await slip(f.users.exec);
      await slip(f.users.admin);
      for (const u of [f.users.devA, f.users.qaB, f.users.clientA]) {
        await get(u, `/project-timeline/projects/${pA}/slip`).expect(403);
        await post(u, resetUrl(), {}).expect(403);
      }
      for (const u of [f.users.admin, f.users.exec]) await post(u, resetUrl(), { reason: 'x' }).expect(403);
      await get(f.users.pmT2, `/project-timeline/projects/${pA}/slip`).expect(404);
      expect(await audits('project_timeline_baseline_reset')).toHaveLength(0);
    });

    it('baseline = import dates; edits and re-imports move it; empty-then-set is not a move; deleted rows drop out', async () => {
      const plan = await importSample();
      const rows = await byPhase(plan);
      const s0 = await slip();
      expect(s0.rows).toHaveLength(11);
      expect(s0.rows.every((r: any) => r.source === 'import' && r.endMoves === 0)).toBe(true);
      expect(s0.baselineFrom).toBeTruthy();

      const dm: any = rows.get('Data Migration'); // end 2026-07-24
      const rehearsal: any = rows.get('Data Migratiaon Rehearsal'); // end empty (typo kept - suggestion not accepted here)
      const design: any = rows.get('Design');
      await post(f.users.pm, `/project-timeline/projects/${pA}/changes`, {
        updates: [
          { id: dm.id, version: dm.version, endDate: '2026-07-31' },
          { id: rehearsal.id, version: rehearsal.version, endDate: '2026-11-20' },
        ],
        creates: [{ module: 'Medical Claim', phase: 'Hypercare', status: 'To Do', startDate: '2026-12-01', endDate: '2026-12-10' }],
        deletes: [{ id: design.id, version: design.version }],
      }).expect(201);
      // Re-import: the file still says Jul 24 for Data Migration -> moves it back.
      await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: await parseSample() }).expect(201);

      const s1 = await slip();
      const b = new Map(s1.rows.map((r: any) => [r.rowId, r]));
      expect(b.get(dm.id)).toEqual(expect.objectContaining({ baselineEnd: '2026-07-24', endMoves: 2, lastMove: expect.objectContaining({ from: '2026-07-31', to: '2026-07-24', by: f.users.pm.email }) }));
      // First end date given (Nov 20) became the baseline - not a move; the
      // re-import (file has no end date) then cleared it: one move, to empty.
      expect(b.get(rehearsal.id)).toEqual(expect.objectContaining({ baselineEnd: '2026-11-20', endMoves: 1, lastMove: expect.objectContaining({ from: '2026-11-20', to: null }) }));
      expect(b.has(design.id)).toBe(false);
      const hypercare = s1.rows.find((r: any) => r.source === 'added');
      expect(hypercare).toEqual(expect.objectContaining({ baselineEnd: '2026-12-10' }));
    });

    it('reset needs a reason, is audited with a snapshot, and slip counts from the new baseline', async () => {
      const plan = await importSample();
      const dm: any = (await byPhase(plan)).get('Data Migration');
      await post(f.users.pm, `/project-timeline/projects/${pA}/changes`, { updates: [{ id: dm.id, version: dm.version, endDate: '2026-08-07' }] }).expect(201);
      expect((await slip()).rows.find((r: any) => r.rowId === dm.id).baselineEnd).toBe('2026-07-24');

      await post(f.users.pm, resetUrl(), { reason: '   ' }).expect(400);
      await post(f.users.pm, resetUrl(), {}).expect(400);
      const after = (await post(f.users.pm, resetUrl(), { reason: 'Steering committee approved the new dates' }).expect(201)).body;
      expect(after.resets).toEqual([expect.objectContaining({ by: f.users.pm.email, reason: 'Steering committee approved the new dates', rows: 11 })]);
      expect(after.rows.find((r: any) => r.rowId === dm.id)).toEqual(expect.objectContaining({ baselineEnd: '2026-08-07', source: 'reset', endMoves: 0 }));
      expect(after.baselineFrom).toBe(after.resets[0].at);

      const [entry] = await audits('project_timeline_baseline_reset');
      expect(entry).toEqual(expect.objectContaining({ userId: f.users.pm.id, userRole: 'program_manager', entityType: 'Project', entityId: pA }));
      const details = JSON.parse(entry.details);
      expect(details.reason).toBe('Steering committee approved the new dates');
      expect(details.snapshot).toHaveLength(11);
      // Older history is untouched.
      expect(await audits('project_timeline_row_updated')).toHaveLength(1);
      // The plan itself is unchanged by a reset.
      expect((await plan_()).rows.find((r: any) => r.id === dm.id).endDate).toBe('2026-08-07');
    });

    const plan_ = () => plan();
  });
});
