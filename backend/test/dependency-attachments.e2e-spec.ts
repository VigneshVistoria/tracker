import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MemoryStorage } from './setup/memory-storage';
import { DEPENDENCY_TASK_RESOLVED_STATUSES, DEPENDENCY_TASK_CANCELLED_STATUS } from '../src/task-dependency-tickets/dependency-tasks';

// Dependency attachments Stage 1 (Salman's request 2026-11-02, decisions
// from the user 2026-11-13): per-project switch (Admin/PM, default off,
// separate from Dependency tasks); requester files when raising, resolver
// files + optional note with Resolve; images/PDF/Word/Excel only, 10 MB,
// 5 per upload, 10 per side; only people who can see the ticket can
// download; who resolved it always recorded; an auto-resolve through the
// linked task gets a system note naming who closed it and when.
describe('Dependency attachments (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let storage: MemoryStorage;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let devC: FixtureUser;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const upload = (u: FixtureUser, ticketId: number, side: string, files: Array<[string, Buffer]>) => {
    let req = http().post(`/task-dependency-tickets/${ticketId}/attachments`).set(auth(u)).field('side', side);
    for (const [name, data] of files) req = req.attach('files', data, name);
    return req;
  };
  const resolveWith = (u: FixtureUser, ticketId: number, note: string | null, files: Array<[string, Buffer]>) => {
    let req = http().patch(`/task-dependency-tickets/${ticketId}/resolve`).set(auth(u));
    if (note != null) req = req.field('note', note);
    for (const [name, data] of files) req = req.attach('files', data, name);
    return req;
  };
  const ticketRow = async (id: number) => (await ds.query(`SELECT * FROM task_dependency_tickets WHERE id = $1`, [id]))[0];
  const fileRows = async (ticketId: number) =>
    ds.query(`SELECT * FROM task_dependency_ticket_attachments WHERE "ticketId" = $1 ORDER BY id`, [ticketId]);
  const json = (d: any) => (typeof d === 'string' ? JSON.parse(d) : d);
  const setSwitch = (on: boolean) => ds.query(`UPDATE projects SET "dependencyAttachmentsEnabled" = $1 WHERE id = $2`, [on, f.projects.pA]);
  const setTasksSwitch = (on: boolean) => ds.query(`UPDATE projects SET "dependencyTasksEnabled" = $1 WHERE id = $2`, [on, f.projects.pA]);

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);
  const PDF = Buffer.from('%PDF-1.4\n%fake pdf body\n');
  const zip = (folder: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml ${folder}document.xml`)]);
  const DOCX = zip('word/');
  const XLSX = zip('xl/');
  const PPTX = zip('ppt/');

  const newTask = async () => {
    seq += 1;
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Parent task ${seq}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
      priority: 'High',
      assigneeUserId: f.users.devA.id,
      assigneeEmail: f.users.devA.email,
      createdByUserId: f.users.pm.id,
      createdByEmail: f.users.pm.email,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return res[0].id as number;
  };

  // devA (parent's assignee) raises a ticket owned by devC, or by an outsider.
  const newTicket = async (ownerExternal?: string) => {
    const parentId = await newTask();
    const res = await post(f.users.devA, '/task-dependency-tickets', {
      parentTaskId: parentId,
      title: 'Need the claims API',
      description: 'Blocked on the claims API endpoint',
      ...(ownerExternal ? { ownerExternal } : { ownerUserId: devC.id }),
    }).expect(201);
    return { parentId, ticketId: res.body.id as number, dependencyTaskId: res.body.dependencyTaskId as number | null };
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    storage = t.storage;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_dependency_ticket_attachments, user_notifications, audit_logs RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const row = (
      await ds.query(
        `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'devC.att@test.local', 'x', 'Name devC', 'developer') RETURNING id`,
        [f.tenants.t1],
      )
    )[0];
    devC = { id: row.id, email: 'devC.att@test.local', tenantId: f.tenants.t1, role: 'developer' };
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    storage.failPutsAfter = null;
    await setSwitch(false);
    await setTasksSwitch(false);
  });

  describe('per-project switch', () => {
    it('is off by default; only Admin and Program Manager can see or switch it', async () => {
      const rows = await ds.query(`SELECT "dependencyAttachmentsEnabled" FROM projects`);
      expect(rows.every((r: any) => r.dependencyAttachmentsEnabled === false)).toBe(true);
      await http().get('/task-dependency-tickets/attachment-switches').expect(401);
      for (const u of [f.users.devA, f.users.qaB, f.users.exec, f.users.clientA]) {
        await get(u, '/task-dependency-tickets/attachment-switches').expect(403);
        await patch(u, `/task-dependency-tickets/attachment-switches/${f.projects.pA}`, { enabled: true }).expect(403);
      }
    });

    it('PM and Admin switch it, audited; separate from Dependency tasks; bad body / other tenant refused', async () => {
      const list = await get(f.users.pm, '/task-dependency-tickets/attachment-switches').expect(200);
      expect(list.body.find((p: any) => p.id === f.projects.pA)).toEqual({ id: f.projects.pA, name: 'Project A', dependencyAttachmentsEnabled: false });
      expect(list.body.some((p: any) => p.id === f.projects.pT2)).toBe(false);
      await patch(f.users.pm, `/task-dependency-tickets/attachment-switches/${f.projects.pA}`, { enabled: true }).expect(200);
      const p = (await ds.query(`SELECT "dependencyAttachmentsEnabled", "dependencyTasksEnabled" FROM projects WHERE id = $1`, [f.projects.pA]))[0];
      expect(p).toEqual({ dependencyAttachmentsEnabled: true, dependencyTasksEnabled: false });
      await patch(f.users.admin, `/task-dependency-tickets/attachment-switches/${f.projects.pA}`, { enabled: false }).expect(200);
      await patch(f.users.pm, `/task-dependency-tickets/attachment-switches/${f.projects.pA}`, { enabled: 'yes' }).expect(400);
      await patch(f.users.pm, `/task-dependency-tickets/attachment-switches/${f.projects.pT2}`, { enabled: true }).expect(404);
      const audit = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = 'dependency_attachments_project_switched' ORDER BY id`);
      expect(audit.map((a: any) => [a.userId, json(a.details)])).toEqual([
        [f.users.pm.id, { from: false, to: true }],
        [f.users.admin.id, { from: true, to: false }],
      ]);
    });

    it('attachments-enabled tells the create form, behind the parent task view check', async () => {
      const parentId = await newTask();
      expect((await get(f.users.devA, `/task-dependency-tickets/attachments-enabled?parentTaskId=${parentId}`).expect(200)).body).toEqual({ enabled: false });
      await setSwitch(true);
      expect((await get(f.users.devA, `/task-dependency-tickets/attachments-enabled?parentTaskId=${parentId}`).expect(200)).body).toEqual({ enabled: true });
      await get(f.users.devNone, `/task-dependency-tickets/attachments-enabled?parentTaskId=${parentId}`).expect(403);
    });
  });

  describe('switch OFF - behaves as before', () => {
    it('no uploads, no note; plain Resolve still works and records who resolved it', async () => {
      const { ticketId } = await newTicket();
      const res = await upload(f.users.devA, ticketId, 'request', [['a.png', PNG]]).expect(400);
      expect(res.body.message).toMatch(/off for this project/);
      await resolveWith(devC, ticketId, 'Done', []).expect(400);
      await resolveWith(devC, ticketId, null, [['a.png', PNG]]).expect(400);
      expect((await ticketRow(ticketId)).status).toBe('open');
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`).expect(200);
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'resolved', resolvedByUserId: devC.id, resolvedVia: 'ticket', resolutionNote: null });
      expect(storage.objects.size).toBe(0);
    });
  });

  describe('request files (switch ON)', () => {
    it('the requester attaches images, PDF, Word and Excel; stored privately under random keys; audited', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const before = storage.objects.size;
      const res = await upload(f.users.devA, ticketId, 'request', [
        ['screen.png', PNG],
        ['spec.pdf', PDF],
        ['notes.docx', DOCX],
        ['data.xlsx', XLSX],
      ]).expect(201);
      expect(res.body.map((x: any) => [x.side, x.fileName, x.uploadedByName])).toEqual([
        ['request', 'screen.png', expect.anything()],
        ['request', 'spec.pdf', expect.anything()],
        ['request', 'notes.docx', expect.anything()],
        ['request', 'data.xlsx', expect.anything()],
      ]);
      const keys = [...storage.objects.keys()].slice(before);
      expect(keys).toHaveLength(4);
      for (const k of keys) expect(k).toMatch(new RegExp(`^task-attachments/dependency-tickets/${f.tenants.t1}/${ticketId}/[0-9a-f-]{36}$`));
      const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_dependency_ticket_files_attached' AND "entityId" = $1`, [ticketId]);
      expect(audit).toHaveLength(1);
      expect(json(audit[0].details).side).toBe('request');
      expect(json(audit[0].details).files.map((x: any) => x.fileName)).toEqual(['screen.png', 'spec.pdf', 'notes.docx', 'data.xlsx']);
    });

    it('nobody else adds request files - not the owner, PM or admin; bad side refused', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      for (const u of [devC, f.users.pm, f.users.admin]) {
        const res = await upload(u, ticketId, 'request', [['a.png', PNG]]).expect(403);
        expect(res.body.message).toMatch(/Only whoever raised this dependency/);
      }
      await upload(f.users.devA, ticketId, 'other', [['a.png', PNG]]).expect(400);
      await upload(f.users.devA, ticketId, 'request', []).expect(400);
      expect(await fileRows(ticketId)).toHaveLength(0);
    });

    it('refuses other types and disguised files, all-or-nothing', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const objects = storage.objects.size;
      const cases: Array<[string, Buffer]> = [
        ['deck.pptx', PPTX],
        ['notes.txt', Buffer.from('plain text')],
        ['data.csv', Buffer.from('a,b\n1,2\n')],
        ['drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
        ['photo.png', Buffer.from('<html><script>alert(1)</script></html>')],
        ['report.pdf', PNG],
        ['empty.png', Buffer.alloc(0)],
      ];
      for (const c of cases) {
        const res = await upload(f.users.devA, ticketId, 'request', [c]).expect(400);
        expect(res.body.message).toMatch(/not an allowed file type/);
      }
      await upload(f.users.devA, ticketId, 'request', [['ok.png', PNG], ['deck.pptx', PPTX]]).expect(400);
      expect(await fileRows(ticketId)).toHaveLength(0);
      expect(storage.objects.size).toBe(objects);
    });

    it('10 MB per file and 5 per upload, enforced while reading the upload', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
      await upload(f.users.devA, ticketId, 'request', [['big.png', big]]).expect(413);
      const six = Array.from({ length: 6 }, (_, i) => [`s${i}.png`, PNG] as [string, Buffer]);
      await upload(f.users.devA, ticketId, 'request', six).expect(400);
      expect(await fileRows(ticketId)).toHaveLength(0);
    });

    it('at most 10 per side', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const five = Array.from({ length: 5 }, (_, i) => [`s${i}.png`, PNG] as [string, Buffer]);
      await upload(f.users.devA, ticketId, 'request', five).expect(201);
      await upload(f.users.devA, ticketId, 'request', five).expect(201);
      const res = await upload(f.users.devA, ticketId, 'request', [['one.png', PNG]]).expect(400);
      expect(res.body.message).toMatch(/at most 10 request files/);
      expect(await fileRows(ticketId)).toHaveLength(10);
    });

    it('a storage failure part-way leaves nothing behind', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const objects = storage.objects.size;
      storage.failPutsAfter = 1;
      await upload(f.users.devA, ticketId, 'request', [['a.png', PNG], ['b.pdf', PDF]]).expect(503);
      expect(await fileRows(ticketId)).toHaveLength(0);
      expect(storage.objects.size).toBe(objects);
    });
  });

  describe('seeing and downloading', () => {
    it('requester, owner, PM and project QA see and download; others get 403; images inline, others download', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const files = (await upload(f.users.devA, ticketId, 'request', [['screen.png', PNG], ['spec.pdf', PDF]]).expect(201)).body;
      for (const u of [f.users.devA, devC, f.users.pm, f.users.admin]) {
        expect((await get(u, `/task-dependency-tickets/${ticketId}/attachments`).expect(200)).body).toHaveLength(2);
      }
      for (const u of [f.users.devNone, f.users.clientA]) {
        await get(u, `/task-dependency-tickets/${ticketId}/attachments`).expect(403);
        await get(u, `/task-dependency-tickets/attachments/${files[0].id}`).expect(403);
      }
      const png = await get(devC, `/task-dependency-tickets/attachments/${files[0].id}`).buffer(true).expect(200);
      expect(png.headers['content-type']).toBe('image/png');
      expect(png.headers['content-disposition']).toMatch(/^inline; filename="screen.png"/);
      expect(png.headers['x-content-type-options']).toBe('nosniff');
      expect(png.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.compare(png.body, PNG)).toBe(0);
      const pdf = await get(devC, `/task-dependency-tickets/attachments/${files[1].id}`).buffer(true).expect(200);
      expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="spec.pdf"/);
      await get(devC, `/task-dependency-tickets/attachments/999999`).expect(404);
    });

    it('files stay visible when the switch is turned off later', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      await upload(f.users.devA, ticketId, 'request', [['a.png', PNG]]).expect(201);
      await setSwitch(false);
      expect((await get(devC, `/task-dependency-tickets/${ticketId}/attachments`).expect(200)).body).toHaveLength(1);
    });
  });

  describe('Resolve with note and files', () => {
    it('owner resolves with a note and files in one step; shown on the waiting task with who resolved it', async () => {
      await setSwitch(true);
      const { parentId, ticketId } = await newTicket();
      const res = await resolveWith(devC, ticketId, '  Endpoint is live, see the attached spec  ', [['spec.pdf', PDF], ['proof.png', PNG]]).expect(200);
      expect(res.body.status).toBe('resolved');
      expect(await ticketRow(ticketId)).toMatchObject({
        status: 'resolved',
        resolvedByUserId: devC.id,
        resolvedVia: 'ticket',
        resolutionNote: 'Endpoint is live, see the attached spec',
      });
      expect((await fileRows(ticketId)).map((r: any) => [r.side, r.fileName, r.uploadedByUserId])).toEqual([
        ['resolution', 'spec.pdf', devC.id],
        ['resolution', 'proof.png', devC.id],
      ]);
      const list = (await get(f.users.devA, `/task-dependency-tickets?parentTaskId=${parentId}`).expect(200)).body;
      expect(list[0]).toMatchObject({ resolvedByName: 'Name devC', resolutionNote: 'Endpoint is live, see the attached spec', systemNote: null });
      const resolvedAudit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_dependency_ticket_resolved' AND "entityId" = $1`, [ticketId]);
      expect(json(resolvedAudit[0].details)).toMatchObject({ resolutionNote: 'Endpoint is live, see the attached spec', fileCount: 2 });
      const history = (await get(f.users.devA, `/task-dependency-tickets/history?parentTaskId=${parentId}`).expect(200)).body;
      expect(history.find((h: any) => h.action === 'task_dependency_ticket_files_attached')).toMatchObject({ side: 'resolution', fileNames: ['spec.pdf', 'proof.png'] });
    });

    it('note is optional; a bad file refuses the whole Resolve and the ticket stays open', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      const objects = storage.objects.size;
      await resolveWith(devC, ticketId, 'Done', [['ok.png', PNG], ['deck.pptx', PPTX]]).expect(400);
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'open', resolvedByUserId: null, resolutionNote: null });
      expect(storage.objects.size).toBe(objects);
      storage.failPutsAfter = 0;
      await resolveWith(devC, ticketId, 'Done', [['ok.png', PNG]]).expect(503);
      expect((await ticketRow(ticketId)).status).toBe('open');
      storage.failPutsAfter = null;
      await resolveWith(devC, ticketId, null, [['ok.png', PNG]]).expect(200);
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'resolved', resolutionNote: null });
    });

    it('note over 5000 characters refused', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`, { note: 'x'.repeat(5001) }).expect(400);
      expect((await ticketRow(ticketId)).status).toBe('open');
    });

    it('only the resolver adds more resolution files afterwards; request files close once resolved', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      await upload(devC, ticketId, 'resolution', [['early.png', PNG]]).expect(403);
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`, { note: 'Done' }).expect(200);
      await upload(devC, ticketId, 'resolution', [['late.png', PNG]]).expect(201);
      for (const u of [f.users.devA, f.users.pm]) {
        const res = await upload(u, ticketId, 'resolution', [['x.png', PNG]]).expect(403);
        expect(res.body.message).toMatch(/Only whoever resolved this dependency/);
      }
      await upload(f.users.devA, ticketId, 'request', [['x.png', PNG]]).expect(403);
    });

    it('external owner: the requester resolves with a note and files', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket('City office');
      await upload(f.users.devA, ticketId, 'request', [['form.pdf', PDF]]).expect(201);
      await resolveWith(f.users.devA, ticketId, 'Letter received', [['letter.pdf', PDF]]).expect(200);
      expect(await ticketRow(ticketId)).toMatchObject({ resolvedByUserId: f.users.devA.id, resolvedVia: 'ticket', resolutionNote: 'Letter received' });
      expect((await fileRows(ticketId)).map((r: any) => r.side)).toEqual(['request', 'resolution']);
    });

    it('reopen clears who resolved it and the note; files stay', async () => {
      await setSwitch(true);
      const { ticketId } = await newTicket();
      await resolveWith(devC, ticketId, 'Done', [['a.png', PNG]]).expect(200);
      await patch(f.users.devA, `/task-dependency-tickets/${ticketId}/reopen`, { reason: 'Still failing on staging' }).expect(200);
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'open', resolvedAt: null, resolvedByUserId: null, resolvedVia: null, resolutionNote: null });
      expect(await fileRows(ticketId)).toHaveLength(1);
    });
  });

  describe('linked dependency task', () => {
    it('Resolve on a ticket with a task: task goes to Pass, ticket keeps resolvedVia=ticket and the resolver', async () => {
      await setSwitch(true);
      await setTasksSwitch(true);
      const { ticketId, dependencyTaskId } = await newTicket();
      expect(dependencyTaskId).toBeTruthy();
      await resolveWith(devC, ticketId, 'Done', [['a.png', PNG]]).expect(200);
      expect((await ds.query(`SELECT status FROM project_tasks WHERE id = $1`, [dependencyTaskId]))[0].status).toBe('Pass');
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'resolved', resolvedByUserId: devC.id, resolvedVia: 'ticket' });
    });

    it('closing the task elsewhere auto-resolves with a system note naming who closed it and when', async () => {
      await setTasksSwitch(true);
      const { parentId, ticketId, dependencyTaskId } = await newTicket();
      await patch(f.users.pm, `/tasks/${dependencyTaskId}/close`).expect(200);
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'resolved', resolvedByUserId: null, resolvedVia: 'linked_task' });
      const list = (await get(f.users.devA, `/task-dependency-tickets?parentTaskId=${parentId}`).expect(200)).body;
      const pmName = (await ds.query(`SELECT COALESCE(NULLIF("fullName", ''), email) AS n FROM users WHERE id = $1`, [f.users.pm.id]))[0].n;
      expect(list[0].resolvedByName).toBe(pmName);
      expect(list[0].systemNote).toMatch(new RegExp(`^Auto-resolved: linked task closed by ${pmName} on \\d{4}-\\d{2}-\\d{2}$`));
      // The owner (not anyone else) may add resolution files to an auto-resolved ticket.
      await setSwitch(true);
      await upload(devC, ticketId, 'resolution', [['a.png', PNG]]).expect(201);
      await upload(f.users.devA, ticketId, 'resolution', [['a.png', PNG]]).expect(403);
    });

    it('a status change with no person on record still gets a note', async () => {
      await setTasksSwitch(true);
      const { parentId, dependencyTaskId } = await newTicket();
      await ds.query(`UPDATE project_tasks SET status = 'Pass' WHERE id = $1`, [dependencyTaskId]);
      const list = (await get(f.users.devA, `/task-dependency-tickets?parentTaskId=${parentId}`).expect(200)).body;
      expect(list[0].systemNote).toMatch(/^Auto-resolved: linked task closed by the system on /);
    });

    it('the trigger in the new migration keeps the same status lists', () => {
      const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-11-dependency-attachments.sql'), 'utf8');
      const resolvedLine = sql.split('\n').find((l) => l.includes(`IF NEW."status" IN (`))!;
      const inSql = resolvedLine.slice(resolvedLine.indexOf('(') + 1, resolvedLine.lastIndexOf(')')).split(',').map((x) => x.trim().replace(/'/g, ''));
      expect(inSql).toEqual(DEPENDENCY_TASK_RESOLVED_STATUSES);
      expect(sql).toContain(`ELSIF NEW."status" = '${DEPENDENCY_TASK_CANCELLED_STATUS}' THEN`);
    });
  });
});
