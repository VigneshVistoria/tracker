import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MemoryStorage } from './setup/memory-storage';

// Defect screenshots (2026-10-12): QA pastes/captures screenshots on
// Create Defect, uploaded through the client portal's pipeline. Proves
// only the filing QA user can upload, only real images are accepted
// (checked by content, 10 MB, at most 5 per defect, all-or-nothing), and
// files are only served to someone who can view the task.
describe('Defect screenshots (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let storage: MemoryStorage;
  let tokenFor: (u: FixtureUser) => string;
  let qaOther: FixtureUser;
  let defectId: number;
  let plainTaskId: number;
  let junkDefectId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const upload = (u: FixtureUser, taskId: number, files: Array<[string, Buffer]>) => {
    let req = http().post(`/tasks/${taskId}/attachments`).set(auth(u));
    for (const [name, data] of files) req = req.attach('files', data, name);
    return req;
  };

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest-of-jpeg')]);
  const PDF = Buffer.from('%PDF-1.4\n%fake pdf body\n');
  const rowCount = async () => Number((await ds.query(`SELECT count(*) FROM "task_attachments"`))[0].count);

  const insertTask = async (values: Record<string, any>) => {
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pB,
      projectName: 'Project B',
      moduleId: f.modules.mB,
      moduleName: 'Motor',
      phaseId: 1,
      phaseName: 'Build',
      title: 'Defect',
      description: 'x',
      status: 'Development',
      assigneeUserId: f.users.devA.id,
      assigneeEmail: f.users.devA.email,
      createdByUserId: f.users.qaB.id,
      createdByEmail: f.users.qaB.email,
      isDefect: true,
      ...values,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return res[0].id as number;
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    storage = t.storage;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE task_attachments, project_tasks, task_qa_reviews, task_dependency_tickets RESTART IDENTITY CASCADE`);
    await ds.query(
      `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project B', $3, 'Motor', 'Build')`,
      [f.tenants.t1, f.projects.pB, f.modules.mB],
    );
    const other = await ds.query(
      `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'qaother@test', 'x', 'QA Other', 'qa') RETURNING id`,
      [f.tenants.t1],
    );
    qaOther = { id: other[0].id, email: 'qaother@test', tenantId: f.tenants.t1, role: 'qa' };
    // In the defect's project, so qaOther CAN view it - only "didn't file it" stops the upload.
    await ds.query(`INSERT INTO "user_projects" ("usersId", "projectsId") VALUES ($1, $2)`, [qaOther.id, f.projects.pB]);
    defectId = await insertTask({});
    plainTaskId = await insertTask({ isDefect: false, title: 'Plain task' });
    junkDefectId = await insertTask({ status: 'Junk', title: 'Junk defect' });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    storage.failPutsAfter = null;
  });

  describe('uploading', () => {
    it('the QA user who filed the defect attaches screenshots; type comes from the content', async () => {
      const res = await upload(f.users.qaB, defectId, [
        ['defect-screenshot-20261012-101500.png', PNG],
        ['defect-screenshot-20261012-101501.jpg', JPEG],
      ]).expect(201);
      expect(res.body.map((x: any) => [x.fileName, x.mimeType, x.sizeBytes])).toEqual([
        ['defect-screenshot-20261012-101500.png', 'image/png', PNG.length],
        ['defect-screenshot-20261012-101501.jpg', 'image/jpeg', JPEG.length],
      ]);
      // Random stored names in their own private bucket, under tenant/task - never the uploaded name.
      const keys = [...storage.objects.keys()];
      expect(keys).toHaveLength(2);
      for (const k of keys) expect(k).toMatch(new RegExp(`^task-attachments/${f.tenants.t1}/${defectId}/[0-9a-f-]{36}$`));
    });

    it('nobody else can upload - not another QA, the assignee, a PM or admin', async () => {
      await get(qaOther, `/tasks/${defectId}/attachments`).expect(200);
      for (const u of [qaOther, f.users.devA, f.users.pm, f.users.admin]) {
        const res = await upload(u, defectId, [['x.png', PNG]]).expect(403);
        expect(res.body.message).toMatch(/Only the QA user who filed this defect/);
      }
    });

    it('only to defects - not to an ordinary task, even one the QA user created', async () => {
      await upload(f.users.qaB, plainTaskId, [['x.png', PNG]]).expect(403);
    });

    it('refuses non-images and disguised files, storing nothing', async () => {
      const before = await rowCount();
      const objects = storage.objects.size;
      const cases: Array<[string, Buffer]> = [
        ['report.pdf', PDF],
        ['photo.png', Buffer.from('<html><script>alert(1)</script></html>')],
        ['drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
        ['shot.png', JPEG],
        ['empty.png', Buffer.alloc(0)],
      ];
      for (const c of cases) {
        const res = await upload(f.users.qaB, defectId, [c]).expect(400);
        expect(res.body.message).toMatch(/not an allowed image type/);
      }
      // One bad file sinks the whole upload.
      await upload(f.users.qaB, defectId, [['ok.png', PNG], ['bad.pdf', PDF]]).expect(400);
      expect(await rowCount()).toBe(before);
      expect(storage.objects.size).toBe(objects);
    });

    it('refuses a file over 10 MB', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
      const before = await rowCount();
      await upload(f.users.qaB, defectId, [['big.png', big]]).expect(413);
      expect(await rowCount()).toBe(before);
    });

    it('caps a defect at 5 screenshots in total', async () => {
      // 2 already attached above.
      await upload(f.users.qaB, defectId, [['3.png', PNG], ['4.png', PNG], ['5.png', PNG], ['6.png', PNG]]).expect(400);
      await upload(f.users.qaB, defectId, [['3.png', PNG], ['4.png', PNG], ['5.png', PNG]]).expect(201);
      const res = await upload(f.users.qaB, defectId, [['6.png', PNG]]).expect(400);
      expect(res.body.message).toMatch(/at most 5 screenshots/);
    });

    it('leaves nothing behind when storage fails part-way', async () => {
      const otherDefect = await insertTask({ title: 'Second defect' });
      storage.failPutsAfter = 1;
      const objects = storage.objects.size;
      await upload(f.users.qaB, otherDefect, [['a.png', PNG], ['b.png', PNG]]).expect(503);
      expect(storage.objects.size).toBe(objects);
      expect(Number((await ds.query(`SELECT count(*) FROM task_attachments WHERE "taskId" = $1`, [otherDefect]))[0].count)).toBe(0);
    });

    it('needs a login', async () => {
      await http().post(`/tasks/${defectId}/attachments`).attach('files', PNG, 'x.png').expect(401);
    });
  });

  describe('viewing', () => {
    it('anyone who can view the task lists and opens its screenshots, served inline with safe headers', async () => {
      for (const u of [f.users.qaB, f.users.devA, f.users.pm, f.users.admin]) {
        const list = await get(u, `/tasks/${defectId}/attachments`).expect(200);
        expect(list.body).toHaveLength(5);
      }
      const first = (await get(f.users.devA, `/tasks/${defectId}/attachments`)).body[0];
      const res = await get(f.users.devA, `/tasks/attachments/${first.id}`).buffer(true).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toMatch(/^inline; filename="defect-screenshot-20261012-101500.png"/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body, PNG)).toBe(0);
    });

    it('someone who cannot view the task gets neither the list nor the file', async () => {
      const first = (await get(f.users.qaB, `/tasks/${defectId}/attachments`)).body[0];
      await get(f.users.devNone, `/tasks/${defectId}/attachments`).expect(403);
      await get(f.users.devNone, `/tasks/attachments/${first.id}`).expect(403);
      await get(f.users.clientB, `/tasks/attachments/${first.id}`).expect(403);
    });

    it('another tenant cannot reach them at all', async () => {
      const first = (await get(f.users.qaB, `/tasks/${defectId}/attachments`)).body[0];
      await get(f.users.pmT2, `/tasks/${defectId}/attachments`).expect(404);
      await get(f.users.pmT2, `/tasks/attachments/${first.id}`).expect(404);
    });

    it('a Junk defect: hidden from non-leadership, and no uploads (nothing stored)', async () => {
      await get(f.users.devA, `/tasks/${junkDefectId}/attachments`).expect(403);
      const objects = storage.objects.size;
      await upload(f.users.qaB, junkDefectId, [['x.png', PNG]]).expect(403);
      expect(storage.objects.size).toBe(objects);
      expect(Number((await ds.query(`SELECT count(*) FROM task_attachments WHERE "taskId" = $1`, [junkDefectId]))[0].count)).toBe(0);
      // Leadership still sees the (empty) list, like the task itself.
      await get(f.users.pm, `/tasks/${junkDefectId}/attachments`).expect(200);
    });

    it('unknown ids are not found', async () => {
      await get(f.users.pm, `/tasks/attachments/999999`).expect(404);
      await get(f.users.pm, `/tasks/999999/attachments`).expect(404);
    });
  });
});
