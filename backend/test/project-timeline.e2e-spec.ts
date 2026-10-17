import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { addDays } from '../src/project-timeline/project-timeline-rules';
import { parseSpreadsheet } from '../src/test-cases/test-case-spreadsheet';
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
      // Export is PM/Admin only (user decision 2026-10-16).
      { method: 'post', url: () => `/project-timeline/projects/${projectId()}/export`, edit: true },
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
        await post(u, `/project-timeline/projects/${pA}/export`, { format: 'csv' }).expect(200);
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

  describe('export', () => {
    const importSample = async () => (await post(f.users.pm, `/project-timeline/projects/${pA}/import`, { rows: await parseSample() }).expect(201)).body.plan;
    const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const exportFile = async (body: any, u = f.users.pm) => {
      const res = await post(u, `/project-timeline/projects/${pA}/export`, body).buffer(true).parse(binary).expect(200);
      return { buffer: res.body as Buffer, headers: res.headers };
    };
    const readBack = (buffer: Buffer, format: string) => parseSpreadsheet(buffer.toString('base64'), format as any);
    const HEADERS = ['Module', 'Phase', 'Team', 'Status', 'Start Date', 'End Date', 'Overdue', 'Overlaps with', 'Slip (days)'];

    it('exports the whole plan in plan order with Overdue, Overlaps and Slip, saving nothing', async () => {
      const saved = await importSample();
      const dm = saved.rows.find((r: any) => r.phase === 'Data Migration');
      await post(f.users.pm, `/project-timeline/projects/${pA}/changes`, { updates: [{ id: dm.id, version: dm.version, endDate: '2026-07-31' }] }).expect(201);
      const auditCount = Number((await ds.query(`SELECT count(*) FROM audit_logs`))[0].count);

      const { buffer, headers } = await exportFile({ format: 'csv' });
      expect(headers['content-type']).toContain('text/csv');
      expect(headers['content-disposition']).toMatch(/^attachment; filename="Project-A-timeline-\d{4}-\d{2}-\d{2}\.csv"$/);
      const sheet = await readBack(buffer, 'csv');
      expect(sheet.headers).toEqual(HEADERS);
      expect(sheet.rows).toHaveLength(11);
      const current = (await plan()).rows;
      expect(sheet.rows.map((r) => r.cells[1])).toEqual(current.map((r: any) => r.phase));
      const byPhase = new Map(sheet.rows.map((r) => [r.cells[1], r.cells]));
      // 2026-07-31 is past in the team time zone, To Do -> overdue; end moved +7 days; overlaps Pilot Run.
      expect(byPhase.get('Data Migration')).toEqual(['Medical Claim', 'Data Migration', 'Vistoria', 'To Do', '13-Jul-26', '31-Jul-26', 'Yes', 'Pilot Run (Staging)', '7']);
      expect(byPhase.get('Requirements Gathering')).toEqual(['Medical Claim', 'Requirements Gathering', 'Vistoria', 'Completed', '1-Jul-26', '10-Jul-26', '', '', '0']);
      expect(byPhase.get('Data Migratiaon Rehearsal')!.slice(4, 9)).toEqual(['1-Nov-26', '', '', '', '']);
      expect(byPhase.get('Pilot Run (Staging)')![7]).toBe('Data Migration'); // Production Readiness starts the day Pilot Run ends - touching, not overlap

      expect(Number((await ds.query(`SELECT count(*) FROM audit_logs`))[0].count)).toBe(auditCount);
    });

    it.each(['csv', 'xlsx'])('a %s export imports back with nothing to change', async (format) => {
      await importSample();
      const { buffer } = await exportFile({ format });
      const parsed = (await post(f.users.pm, '/project-timeline/import/parse', { format, fileBase64: buffer.toString('base64') }).expect(201)).body;
      expect(parsed.ignoredColumns).toEqual(['Overdue', 'Overlaps with', 'Slip (days)']);
      const preview = (await post(f.users.pm, `/project-timeline/projects/${pA}/import/preview`, { rows: parsed.rows }).expect(201)).body;
      expect(preview.summary).toEqual(expect.objectContaining({ newRows: 0, changedRows: 0, unchangedRows: 11, missingRows: 0, errorRows: 0 }));
    });

    it('xlsx dates are real Excel dates', async () => {
      await importSample();
      const { buffer, headers } = await exportFile({ format: 'xlsx' });
      expect(headers['content-type']).toContain('spreadsheetml');
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const cell = wb.worksheets[0].getRow(2).getCell(5);
      expect(cell.value).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(cell.numFmt).toBe('d-mmm-yy');
    });

    it('rowIds exports just those rows, in plan order, still showing overlaps with rows left out', async () => {
      const saved = await importSample();
      const pick = (phase: string) => saved.rows.find((r: any) => r.phase === phase).id;
      const { buffer } = await exportFile({ format: 'csv', rowIds: [pick('Pilot Run (Staging)'), pick('Requirements Gathering')] });
      const sheet = await readBack(buffer, 'csv');
      expect(sheet.rows.map((r) => r.cells[1])).toEqual(['Requirements Gathering', 'Pilot Run (Staging)']);
      expect(sheet.rows[1].cells[7]).toBe('Data Migration'); // Production Readiness starts the day Pilot Run ends - touching, not overlap
      const empty = await readBack((await exportFile({ format: 'csv', rowIds: [] })).buffer, 'csv');
      expect(empty.rows).toHaveLength(0);
    });

    it('refuses rows that are not in this plan, bad formats and other tenants', async () => {
      const saved = await importSample();
      await post(f.users.pm, `/project-timeline/projects/${pA}/export`, { format: 'csv', rowIds: [saved.rows[0].id, 999999] }).expect(400);
      await post(f.users.pm, `/project-timeline/projects/${pA}/export`, { format: 'pdf' }).expect(400);
      await post(f.users.pm, `/project-timeline/projects/${pA}/export`, { format: 'csv', rowIds: ['x'] }).expect(400);
      await post(f.users.pmT2, `/project-timeline/projects/${pA}/export`, { format: 'csv' }).expect(404);
      const other = (await ds.query(`SELECT id FROM projects WHERE id <> $1 AND "tenantId" = $2 LIMIT 1`, [pA, f.tenants.t1]))[0];
      if (other) await post(f.users.pm, `/project-timeline/projects/${other.id}/export`, { format: 'csv', rowIds: [saved.rows[0].id] }).expect(400);
    });
  });

  // Stage B (2026-10-16): "starts after" links between phases.
  describe('dependencies', () => {
    const URL = () => `/project-timeline/projects/${pA}/dependencies`;
    const send = (method: 'post' | 'patch' | 'delete', u: FixtureUser, url: string, body: any = {}) => (http() as any)[method](url).set(auth(u)).send(body);
    const ids: Record<string, number> = {};
    const addRow = async (key: string, projectId: number, tenantId = f.tenants.t1) => {
      const res = await ds.query(
        `INSERT INTO project_timeline_rows ("tenantId", "projectId", module, phase, "matchKey", status, "startDate", "endDate", "sortOrder")
         VALUES ($1, $2, 'Medical Claim', $3, $4, 'To Do', '2026-10-01', '2026-10-10', 1) RETURNING id`,
        [tenantId, projectId, `Phase ${key}`, `medical claim|phase ${key.toLowerCase()}`],
      );
      ids[key] = res[0].id;
    };

    beforeEach(async () => {
      await ds.query(`DELETE FROM project_timeline_dependencies`);
      await ds.query(`DELETE FROM project_timeline_rows`);
      for (const k of ['A', 'B', 'C']) await addRow(k, pA);
      await addRow('OtherProject', f.projects.pB);
      await addRow('OtherTenant', f.projects.pT2, f.tenants.t2);
    });

    it('401 logged out; 403 for Developer/QA/Client; Executive reads but cannot change', async () => {
      await http().get(URL()).expect(401);
      await http().post(URL()).send({}).expect(401);
      for (const u of [f.users.devA, f.users.qaB, f.users.clientA]) {
        await get(u, URL()).expect(403);
        await post(u, URL(), {}).expect(403); // 403 before the body is checked
        await send('patch', u, `${URL()}/1`, {}).expect(403);
        await send('delete', u, `${URL()}/1`).expect(403);
      }
      await get(f.users.exec, URL()).expect(200);
      await post(f.users.exec, URL(), { predecessorRowId: ids.A, successorRowId: ids.B }).expect(403);
      expect(await ds.query(`SELECT * FROM project_timeline_dependencies`)).toEqual([]);
    });

    it('PM adds one (audited with names); Admin changes the gap and removes it (audited); list follows', async () => {
      const added = (await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.B }).expect(201)).body;
      expect(added).toEqual([expect.objectContaining({ predecessorRowId: ids.A, successorRowId: ids.B, lagDays: 0 })]);
      const a = (await audits('project_timeline_dependency_added'))[0];
      expect(a).toMatchObject({ userId: f.users.pm.id, entityType: 'ProjectTimelineDependency', entityId: added[0].id });
      expect(JSON.parse(a.details)).toMatchObject({ predecessor: { id: ids.A, phase: 'Phase A' }, successor: { id: ids.B, phase: 'Phase B' }, lagDays: 0 });

      const updated = (await send('patch', f.users.admin, `${URL()}/${added[0].id}`, { lagDays: 3 }).expect(200)).body;
      expect(updated[0].lagDays).toBe(3);
      expect(JSON.parse((await audits('project_timeline_dependency_updated'))[0].details).lagDays).toEqual({ old: 0, new: 3 });
      await send('patch', f.users.admin, `${URL()}/${added[0].id}`, { lagDays: 3 }).expect(200);
      expect(await audits('project_timeline_dependency_updated')).toHaveLength(1); // no change, no audit

      expect((await send('delete', f.users.admin, `${URL()}/${added[0].id}`).expect(200)).body).toEqual([]);
      expect(await audits('project_timeline_dependency_removed')).toHaveLength(1);
      expect((await get(f.users.exec, URL()).expect(200)).body).toEqual([]);
    });

    it('refuses self-links, duplicates, loops, bad gaps, and phases from another project or tenant', async () => {
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.A }).expect(400);
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.B }).expect(201);
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.B }).expect(409);
      await post(f.users.pm, URL(), { predecessorRowId: ids.B, successorRowId: ids.C }).expect(201);
      expect((await post(f.users.pm, URL(), { predecessorRowId: ids.C, successorRowId: ids.A }).expect(400)).body.message).toMatch(/loop/);
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.C, lagDays: 366 }).expect(400);
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.C, lagDays: -1 }).expect(400);
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.OtherProject }).expect(400);
      await post(f.users.pm, URL(), { predecessorRowId: ids.OtherTenant, successorRowId: ids.A }).expect(400);
      await get(f.users.pmT2, URL()).expect(404);
      const list = (await get(f.users.pm, URL()).expect(200)).body;
      expect(list).toHaveLength(2);
      await send('delete', f.users.pmT2, `/project-timeline/projects/${f.projects.pT2}/dependencies/${list[0].id}`).expect(404);
      expect(await audits('project_timeline_dependency_added')).toHaveLength(2);
    });

    it('deleting a phase through Save changes takes its links with it; nothing else changes', async () => {
      await post(f.users.pm, URL(), { predecessorRowId: ids.A, successorRowId: ids.B }).expect(201);
      await post(f.users.pm, URL(), { predecessorRowId: ids.B, successorRowId: ids.C }).expect(201);
      const before = (await plan()).rows;
      const b = before.find((r: any) => r.id === ids.B);
      await post(f.users.pm, `/project-timeline/projects/${pA}/changes`, { creates: [], updates: [], deletes: [{ id: b.id, version: b.version }] }).expect(201);
      expect((await get(f.users.pm, URL()).expect(200)).body).toEqual([]);
      const after = (await plan()).rows;
      expect(after.map((r: any) => [r.id, r.startDate, r.endDate])).toEqual(before.filter((r: any) => r.id !== ids.B).map((r: any) => [r.id, r.startDate, r.endDate]));
    });
  });

  // Stage C (2026-10-16): link phases to tickets; progress from them.
  describe('ticket links', () => {
    const base = () => `/project-timeline/projects/${pA}`;
    const del = (u: FixtureUser, url: string) => http().delete(url).set(auth(u));
    let rowId: number;
    let otherRowId: number;
    let phaseBuild: number;
    let phaseTest: number;
    const tix: Record<string, number> = {};

    const ticket = async (key: string, status: string, phaseId: number, projectId = pA, moduleId = f.modules.mA) => {
      const res = await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "dueDate",
           "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'x', $5, 'x', $6, '2099-12-31', $7, $8, $9, $10) RETURNING id`,
        [f.tenants.t1, projectId, moduleId, phaseId, `Ticket ${key}`, status, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      );
      tix[key] = res[0].id;
    };

    beforeEach(async () => {
      await ds.query(`DELETE FROM project_timeline_ticket_links`);
      await ds.query(`DELETE FROM project_timeline_rows`);
      await ds.query(`DELETE FROM project_tasks`);
      await ds.query(`DELETE FROM phases WHERE name IN ('Build', 'Test')`);
      const r = await ds.query(
        `INSERT INTO project_timeline_rows ("tenantId", "projectId", module, phase, "matchKey", status, "sortOrder")
         VALUES ($1, $2, 'Medical Claim', 'Development', 'medical claim|development', 'Completed', 1),
                ($1, $2, 'Medical Claim', 'UAT', 'medical claim|uat', 'To Do', 2) RETURNING id`,
        [f.tenants.t1, pA],
      );
      [rowId, otherRowId] = r.map((x: any) => x.id);
      const ph = await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", name) VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build'), ($1, $2, 'Project A', $3, 'Medical Claim', 'Test') RETURNING id`,
        [f.tenants.t1, pA, f.modules.mA],
      );
      [phaseBuild, phaseTest] = ph.map((x: any) => x.id);
      await ticket('dev', 'Development', phaseBuild);
      await ticket('fb', 'Feedback', phaseBuild);
      await ticket('pass', 'Pass', phaseBuild);
      await ticket('junk', 'Junk', phaseBuild);
      await ticket('closed', 'Closed', phaseBuild);
      await ticket('test', 'Pass', phaseTest);
      await ticket('otherProject', 'Pass', phaseTest, f.projects.pB, f.modules.mB);
    });

    it('401 logged out; 403 for Developer/QA/Client; Executive reads progress but cannot pick or change', async () => {
      await http().get(`${base()}/ticket-progress`).expect(401);
      for (const u of [f.users.devA, f.users.qaB, f.users.clientA]) {
        await get(u, `${base()}/ticket-progress`).expect(403);
        await post(u, `${base()}/ticket-links`, {}).expect(403);
        await del(u, `${base()}/ticket-links/1`).expect(403);
      }
      await get(f.users.exec, `${base()}/ticket-progress`).expect(200);
      for (const url of ['ticket-link-options', 'ticket-search?q=x']) await get(f.users.exec, `${base()}/${url}`).expect(403);
      await post(f.users.exec, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mA }).expect(403);
    });

    it('a module+phase link counts its tickets with the status-config %, Junk/Closed left out; a single ticket adds on', async () => {
      let body = (await post(f.users.pm, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mA, phaseId: phaseBuild }).expect(201)).body;
      let row = body.rows.find((r: any) => r.rowId === rowId);
      expect(row.tickets.map((t: any) => t.id).sort()).toEqual([tix.dev, tix.fb, tix.pass, tix.closed].sort());
      expect(row.progress).toEqual({ counted: 3, done: 1, open: 2, hold: 0, moving: 2, leftOut: 1, percent: 50 });
      body = (await post(f.users.admin, `${base()}/ticket-links`, { rowId, taskId: tix.test }).expect(201)).body;
      row = body.rows.find((r: any) => r.rowId === rowId);
      expect(row.progress).toMatchObject({ counted: 4, done: 2, percent: 63 });
      expect(body.links.map((l: any) => [l.kind, l.moduleName, l.phaseName, l.taskTitle])).toEqual([
        ['module', 'Medical Claim', 'Build', null],
        ['ticket', null, null, 'Ticket test'],
      ]);
      // A ticket created later in the linked phase is picked up by itself.
      await ticket('later', 'Pass', phaseBuild);
      row = (await get(f.users.exec, `${base()}/ticket-progress`).expect(200)).body.rows.find((r: any) => r.rowId === rowId);
      expect(row.progress.counted).toBe(5);
      const added = await audits('project_timeline_ticket_link_added');
      expect(added).toHaveLength(2);
      expect(JSON.parse(added[0].details)).toMatchObject({ row: { id: rowId, phase: 'Development' }, module: { name: 'Medical Claim' }, phase: { name: 'Build' } });
    });

    it('refuses both/neither kinds, wrong module/phase/project/tenant tickets, Junk tickets and duplicates', async () => {
      await post(f.users.pm, `${base()}/ticket-links`, { rowId }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mA, taskId: tix.dev }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, taskId: tix.dev, phaseId: phaseBuild }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mB }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, taskId: tix.otherProject }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, taskId: tix.junk }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId: 999999, moduleId: f.modules.mA }).expect(400);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mA }).expect(201);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mA }).expect(409);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId, moduleId: f.modules.mA, phaseId: phaseTest }).expect(201); // narrower link is different
      await post(f.users.pmT2, `/project-timeline/projects/${f.projects.pT2}/ticket-links`, { rowId, moduleId: f.modules.mA }).expect(400);
      expect(await audits('project_timeline_ticket_link_added')).toHaveLength(2);
    });

    it('options list the project modules + phases; search finds by #id or title, never Junk or other projects', async () => {
      const opts = (await get(f.users.pm, `${base()}/ticket-link-options`).expect(200)).body;
      const mc = opts.find((m: any) => m.id === f.modules.mA);
      expect(mc.phases.map((p: any) => p.name).sort()).toEqual(['Build', 'Test']);
      expect(opts.some((m: any) => m.id === f.modules.mB)).toBe(false);
      const byId = (await get(f.users.pm, `${base()}/ticket-search?q=%23${tix.fb}`).expect(200)).body;
      expect(byId.map((t: any) => t.id)).toContain(tix.fb);
      const byTitle = (await get(f.users.pm, `${base()}/ticket-search?q=ticket`).expect(200)).body.map((t: any) => t.id);
      expect(byTitle).not.toContain(tix.junk);
      expect(byTitle).not.toContain(tix.otherProject);
      expect((await get(f.users.pm, `${base()}/ticket-search?q=100%25`).expect(200)).body).toEqual([]);
    });

    it('removing a link is audited; deleting the phase removes its links; tickets are never touched', async () => {
      const before = await ds.query(`SELECT id, status, "updatedAt" FROM project_tasks ORDER BY id`);
      const body = (await post(f.users.pm, `${base()}/ticket-links`, { rowId: otherRowId, taskId: tix.dev }).expect(201)).body;
      expect((await del(f.users.admin, `${base()}/ticket-links/${body.links[0].id}`).expect(200)).body.links).toEqual([]);
      const removed = await audits('project_timeline_ticket_link_removed');
      expect(removed).toHaveLength(1);
      expect(JSON.parse(removed[0].details)).toMatchObject({ row: { id: otherRowId, phase: 'UAT' }, taskId: tix.dev, ticket: { id: tix.dev, title: 'Ticket dev' } });
      await del(f.users.pm, `${base()}/ticket-links/${body.links[0].id}`).expect(404);
      await post(f.users.pm, `${base()}/ticket-links`, { rowId: otherRowId, moduleId: f.modules.mA }).expect(201);
      const r = (await plan()).rows.find((x: any) => x.id === otherRowId);
      await post(f.users.pm, `/project-timeline/projects/${pA}/changes`, { creates: [], updates: [], deletes: [{ id: r.id, version: r.version }] }).expect(201);
      expect((await get(f.users.pm, `${base()}/ticket-progress`).expect(200)).body.links).toEqual([]);
      expect(await ds.query(`SELECT id, status, "updatedAt" FROM project_tasks ORDER BY id`)).toEqual(before);
    });
  });

  describe('forecast and what changed', () => {
    const base = () => `/project-timeline/projects/${pA}`;
    const ids: Record<string, number> = {};
    let today: string;
    const addRow = async (key: string, status: string, start: number, end: number, sortOrder: number) => {
      const res = await ds.query(
        `INSERT INTO project_timeline_rows ("tenantId", "projectId", module, phase, "matchKey", status, "startDate", "endDate", "sortOrder")
         VALUES ($1, $2, 'Medical Claim', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [f.tenants.t1, pA, key, `medical claim|${key.toLowerCase()}`, status, addDays(today, start), addDays(today, end), sortOrder],
      );
      ids[key] = res[0].id;
    };

    beforeEach(async () => {
      await ds.query(`DELETE FROM project_timeline_ticket_links`);
      await ds.query(`DELETE FROM project_timeline_dependencies`);
      await ds.query(`DELETE FROM project_timeline_rows`);
      await ds.query(`DELETE FROM project_tasks`);
      today = (await plan()).today;
    });

    it('401 logged out; 403 for Developer/QA/Client; Executive reads both', async () => {
      for (const url of ['forecast', 'recent-changes']) {
        await http().get(`${base()}/${url}`).expect(401);
        for (const u of [f.users.devA, f.users.qaB, f.users.clientA]) await get(u, `${base()}/${url}`).expect(403);
        await get(f.users.exec, `${base()}/${url}`).expect(200);
      }
      await get(f.users.pm, `/project-timeline/projects/${f.projects.pT2}/forecast`).expect(404);
    });

    it('forecast pushes a waiting phase after an overdue one and uses ticket pace, saving nothing', async () => {
      await addRow('Build', 'Delayed', -14, -5, 1);
      await addRow('UAT', 'To Do', 0, 3, 2);
      await addRow('Docs', 'In Progress', -9, 1, 3);
      await post(f.users.pm, `${base()}/dependencies`, { predecessorRowId: ids.Build, successorRowId: ids.UAT, lagDays: 1 }).expect(201);
      const ph = await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", name) VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Docs') RETURNING id`,
        [f.tenants.t1, pA, f.modules.mA],
      );
      for (const status of ['Pass', 'Development']) {
        const t = await ds.query(
          `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "dueDate",
             "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
           VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Docs', 'Doc ticket', 'x', $5, '2099-12-31', $6, $7, $6, $7) RETURNING id`,
          [f.tenants.t1, pA, f.modules.mA, ph[0].id, status, f.users.pm.id, f.users.pm.email],
        );
        await post(f.users.pm, `${base()}/ticket-links`, { rowId: ids.Docs, taskId: t[0].id }).expect(201);
      }
      const before = await ds.query(`SELECT * FROM project_timeline_rows ORDER BY id`);
      const auditCount = (await ds.query(`SELECT count(*) FROM audit_logs`))[0].count;
      const fc = (await get(f.users.exec, `${base()}/forecast`).expect(200)).body;
      const row = (id: number) => fc.rows.find((r: any) => r.id === id);
      expect(row(ids.Build)).toMatchObject({ end: today, slipDays: 5, reasons: [{ code: 'overdue' }] });
      expect(row(ids.UAT)).toMatchObject({ start: addDays(today, 2), end: addDays(today, 5), slipDays: 2, reasons: [{ code: 'waits_on', rowId: ids.Build }] });
      // Docs: 10 days in at 50% -> 20 days -> ends today + 10.
      expect(row(ids.Docs)).toMatchObject({ end: addDays(today, 10), slipDays: 9, reasons: [{ code: 'ticket_pace', percent: 50, elapsedDays: 10 }] });
      expect(fc).toMatchObject({ today, plannedEnd: addDays(today, 3), likelyEnd: addDays(today, 10), slipDays: 7, drivers: [ids.Docs] });
      expect(await ds.query(`SELECT * FROM project_timeline_rows ORDER BY id`)).toEqual(before);
      expect((await ds.query(`SELECT count(*) FROM audit_logs`))[0].count).toBe(auditCount);
    });

    it('what changed nets the period from the audit log, only for this project, within the days asked', async () => {
      await addRow('Build', 'To Do', 1, 10, 1);
      let r = (await plan()).rows[0];
      await post(f.users.pm, `${base()}/changes`, { updates: [{ id: r.id, version: r.version, endDate: addDays(today, 15) }] }).expect(201);
      r = (await plan()).rows[0];
      await post(f.users.admin, `${base()}/changes`, { updates: [{ id: r.id, version: r.version, endDate: addDays(today, 20), status: 'In Progress' }] }).expect(201);
      await post(f.users.pm, `${base()}/changes`, { creates: [{ module: 'Pre-Auth', phase: 'Design', status: 'To Do', sortOrder: 2 }] }).expect(201);
      await post(f.users.pm, `${base()}/baseline/reset`, { reason: 'Scope change' }).expect(201);
      // Another project's change and an entry older than the period stay out.
      await ds.query(
        `INSERT INTO audit_logs ("tenantId", "userEmail", action, "entityType", "entityId", details, "createdAt") VALUES
           ($1, 'x@x.com', 'project_timeline_baseline_reset', 'Project', $2, '{"reason":"other"}', now()),
           ($1, 'x@x.com', 'project_timeline_baseline_reset', 'Project', $3, '{"reason":"old"}', now() - interval '10 days')`,
        [f.tenants.t1, f.projects.pB, pA],
      );
      const body = (await get(f.users.exec, `${base()}/recent-changes`).expect(200)).body;
      expect(body.days).toBe(7);
      const build = body.phases.find((p: any) => p.rowId === r.id);
      expect(build).toMatchObject({ kind: 'changed', endShiftDays: 10, changes: { endDate: { old: addDays(today, 10), new: addDays(today, 20) }, status: { old: 'To Do', new: 'In Progress' } } });
      expect(build.by.sort()).toEqual([f.users.admin.email, f.users.pm.email].sort());
      expect(body.phases.find((p: any) => p.kind === 'added')).toMatchObject({ module: 'Pre-Auth', phase: 'Design' });
      expect(body.events.map((e: any) => e.text)).toEqual(['Baseline reset: “Scope change”']);
      expect(body.totals).toMatchObject({ added: 1, endLater: 1, statusChanged: 1 });
      const month = (await get(f.users.pm, `${base()}/recent-changes?days=30`).expect(200)).body;
      expect(month.events.map((e: any) => e.text)).toEqual(['Baseline reset: “Scope change”', 'Baseline reset: “old”']);
      expect((await get(f.users.pm, `${base()}/recent-changes?days=5000`).expect(200)).body.days).toBe(90);
    });
  });
});
