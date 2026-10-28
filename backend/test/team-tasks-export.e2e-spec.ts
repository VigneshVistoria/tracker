import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Team Tasks export (2026-10-28): PM/Admin only (403 for anyone else),
// every matching row rather than one page, the page's filters, and an
// audit entry per export.
describe('Team Tasks export (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  const DEV_FAILED = 'Development,Failed,Released - With Showstoppers,PM Feedback,Not Ready for Testing';

  const http = () => request(app.getHttpServer());
  const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const exportAs = (u: FixtureUser, query: string) =>
    http().get(`/tasks/team/export?${query}`).set('Authorization', `Bearer ${tokenFor(u)}`).buffer(true).parse(binary);
  const sheetRows = async (body: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as any);
    const sheet = wb.getWorksheet('Team Tasks')!;
    const rows: any[][] = [];
    sheet.eachRow((row, n) => {
      if (n > 1) rows.push((row.values as any[]).slice(1));
    });
    return rows;
  };
  const exportAudits = () => ds.query(`SELECT * FROM audit_logs WHERE action = 'team_tasks_exported' ORDER BY id`);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_dependency_tickets, audit_logs RESTART IDENTITY CASCADE`);
    const phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    // 60 tasks - more than the page's default page size of 50 - for devA,
    // 1 for qaB, and one in another tenant that must never appear.
    const insert = (tenantId: number, assignee: FixtureUser, title: string, status = 'Development') =>
      ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "dueDate")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', $6, $7, $8, $9, $10, '2026-11-03') RETURNING id`,
        [tenantId, f.projects.pA, f.modules.mA, phaseId, title, status, assignee.id, assignee.email, f.users.pm.id, f.users.pm.email],
      );
    let firstId = 0;
    for (let i = 1; i <= 60; i++) {
      const [row] = await insert(f.tenants.t1, f.users.devA, `Dev task ${i}`);
      if (i === 1) firstId = row.id;
    }
    await insert(f.tenants.t1, f.users.qaB, 'QA person task', 'Feedback');
    await insert(f.tenants.t2, f.users.pmT2, 'Other tenant task');
    await ds.query(
      `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", "title", "description", "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", "status")
       VALUES ($1, $2, 'Need the API key', 'x', $3, $4, $5, $6, 'open')`,
      [f.tenants.t1, firstId, f.users.devA.id, f.users.devA.email, f.users.qaB.id, f.users.qaB.email],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['exec', 'devA', 'qaB'])('%s gets a 403 and nothing is logged', async (key) => {
    await exportAs(f.users[key], 'format=pdf').expect(403);
    await exportAs(f.users[key], 'format=xlsx').expect(403);
    expect(await exportAudits()).toHaveLength(0);
  });

  it('PM gets every matching row in Excel, not just one page', async () => {
    const res = await exportAs(f.users.pm, 'format=xlsx').expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="team-tasks-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const rows = await sheetRows(res.body);
    expect(rows).toHaveLength(61);
    expect(rows.some((r) => r[2] === 'Other tenant task')).toBe(false);
  });

  it("follows the page's filters, including the dependency rows on Development / Failed", async () => {
    const res = await exportAs(
      f.users.pm,
      `format=xlsx&status=${encodeURIComponent(DEV_FAILED)}&assigneeUserId=${f.users.devA.id}&includeDependencies=true&sortKey=title&sortDir=desc`,
    ).expect(200);
    const rows = await sheetRows(res.body);
    expect(rows).toHaveLength(61);
    expect(rows.filter((r) => r[0] === 'Tasks')).toHaveLength(60);
    // Column sort applied inside the section: "Dev task 9" sorts last-first.
    expect(rows[0][2]).toBe('Dev task 9');
    const dependency = rows[60];
    expect([dependency[0], dependency[2], dependency[3], dependency[11]]).toEqual(['Dependencies', 'Need the API key', 'Dependency', 'Name qaB']);
    expect(dependency[12]).toMatch(/^#\d+ Dev task 1$/);
  });

  it('Admin can export a PDF', async () => {
    const res = await exportAs(f.users.admin, `format=pdf&assigneeUserId=${f.users.qaB.id}`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('records each export: who, format, filters and row count', async () => {
    const entries = await exportAudits();
    expect(entries).toHaveLength(3);
    const [, filtered, admin] = entries;
    expect(filtered).toMatchObject({ userId: f.users.pm.id, userEmail: f.users.pm.email, userRole: 'program_manager', tenantId: f.tenants.t1 });
    const details = JSON.parse(filtered.details);
    expect(details).toMatchObject({
      format: 'xlsx',
      rowCount: 61,
      filters: { Tab: 'Development / Failed', Assignee: 'Name devA', 'Hold/Closed': 'Hidden' },
      query: { assigneeUserId: f.users.devA.id, includeDependencies: true, sortKey: 'title', sortDir: 'desc' },
    });
    expect(admin).toMatchObject({ userId: f.users.admin.id, userRole: 'admin' });
    expect(JSON.parse(admin.details)).toMatchObject({ format: 'pdf', rowCount: 1, filters: { Assignee: 'Name qaB' } });
  });

  it('rejects a bad format or date', async () => {
    await exportAs(f.users.pm, 'format=csv').expect(400);
    await exportAs(f.users.pm, 'format=pdf&dueFrom=tomorrow').expect(400);
    await exportAs(f.users.pm, 'format=pdf&assigneeUserId=abc').expect(400);
  });
});
