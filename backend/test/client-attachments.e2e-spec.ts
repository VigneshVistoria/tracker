import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MemoryStorage } from './setup/memory-storage';

// Client portal Stage 3: attachments. Proves uploads are type- and
// size-checked by content, all-or-nothing, and that a file is only ever
// served to someone who can see its ticket - with team-only files (on
// internal notes) never reaching client users.
describe('Client ticket attachments (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let storage: MemoryStorage;
  let tokenFor: (u: FixtureUser) => string;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    storage = t.storage;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    storage.failPutsAfter = null;
  });

  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => request(app.getHttpServer()).get(url).set(auth(u));
  const upload = (u: FixtureUser, ticketId: number, files: Array<[string, Buffer]>, commentId?: number) => {
    let req = request(app.getHttpServer()).post(`/client-portal/tickets/${ticketId}/attachments`).set(auth(u));
    if (commentId !== undefined) req = req.field('commentId', String(commentId));
    for (const [name, data] of files) req = req.attach('files', data, name);
    return req;
  };

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);
  const PDF = Buffer.from('%PDF-1.4\n%fake pdf body\n');
  const TXT = Buffer.from('Line one\nLine two\n');
  const fileCount = async () => Number((await ds.query(`SELECT count(*) FROM "client_ticket_attachments"`))[0].count);

  describe('uploading', () => {
    it('a client attaches files to their own ticket; type comes from the content', async () => {
      const res = await upload(f.users.clientA, f.tickets.tA1, [['screen.png', PNG], ['report.pdf', PDF], ['notes.txt', TXT]]).expect(201);
      expect(res.body.files.map((x: any) => [x.fileName, x.mimeType, x.isInternal])).toEqual([
        ['screen.png', 'image/png', false],
        ['report.pdf', 'application/pdf', false],
        ['notes.txt', 'text/plain', false],
      ]);
      const keys = [...storage.objects.keys()];
      expect(keys).toHaveLength(3);
      // Random stored names under tenant/client/ticket - never the uploaded name.
      for (const k of keys) {
        expect(k).toMatch(new RegExp(`^client-portal-attachments/${f.tenants.t1}/${f.clients.cA}/${f.tickets.tA1}/[0-9a-f-]{36}$`));
      }
    });

    it('keeps non-English file names', async () => {
      const res = await upload(f.users.clientA, f.tickets.tA1, [['تقرير المطالبة.pdf', PDF]]).expect(201);
      expect(res.body.files.map((x: any) => x.fileName)).toContain('تقرير المطالبة.pdf');
    });

    it('refuses disallowed and disguised files', async () => {
      const cases: Array<[string, Buffer]> = [
        ['photo.png', Buffer.from('<html><script>alert(1)</script></html>')],
        ['drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
        ['setup.exe', Buffer.from('MZ\x90\x00')],
        ['page.html', Buffer.from('<!doctype html><p>hi</p>')],
        ['notes.txt', Buffer.from('hello <script>steal()</script>')],
        ['letter.docx', Buffer.from('PK\x03\x04 just a zip, not a word document')],
        ['scan.pdf', PNG],
        ['empty.txt', Buffer.alloc(0)],
      ];
      for (const file of cases) {
        await upload(f.users.clientA, f.tickets.tA1, [file]).expect(400);
      }
    });

    it('an upload is all-or-nothing: one bad file stores none', async () => {
      const before = await fileCount();
      const objects = storage.objects.size;
      await upload(f.users.clientA, f.tickets.tA1, [['ok.png', PNG], ['bad.png', Buffer.from('nope')]]).expect(400);
      expect(await fileCount()).toBe(before);
      expect(storage.objects.size).toBe(objects);
    });

    it('if storage fails part-way, already-stored files are removed again', async () => {
      const before = await fileCount();
      const objects = storage.objects.size;
      storage.failPutsAfter = 1;
      await upload(f.users.clientA, f.tickets.tA1, [['a.png', PNG], ['b.png', PNG]]).expect(503);
      expect(await fileCount()).toBe(before);
      expect(storage.objects.size).toBe(objects);
    });

    it('enforces 10 MB per file and 5 files per upload', async () => {
      const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
      await upload(f.users.clientA, f.tickets.tA1, [['big.pdf', big]]).expect(413);
      const six = Array.from({ length: 6 }, (_, i) => [`f${i}.png`, PNG] as [string, Buffer]);
      await upload(f.users.clientA, f.tickets.tA1, six).expect(400);
      await upload(f.users.clientA, f.tickets.tA1, []).expect(400);
    });

    it("nobody can upload to another client's ticket - it's not found", async () => {
      await upload(f.users.clientA, f.tickets.tB1, [['x.png', PNG]]).expect(404);
      await upload(f.users.qaB, f.tickets.tA1, [['x.png', PNG]]).expect(404);
      await upload(f.users.devNone, f.tickets.tA1, [['x.png', PNG]]).expect(404);
      await upload(f.users.clientC, f.tickets.tC1, [['x.png', PNG]]).expect(404);
      await upload(f.users.pmT2, f.tickets.tA1, [['x.png', PNG]]).expect(404);
    });
  });

  describe('internal-note files', () => {
    let noteId: number;
    let internalFileId: number;

    beforeAll(async () => {
      const note = await request(app.getHttpServer())
        .post(`/client-portal/tickets/${f.tickets.tA1}/comments`)
        .set(auth(f.users.devA))
        .send({ body: 'Log from the server', isInternal: true })
        .expect(201);
      noteId = note.body.comments.find((c: any) => c.body === 'Log from the server').id;
      const res = await upload(f.users.devA, f.tickets.tA1, [['server-log.txt', Buffer.from('SECRET LOG LINE')]], noteId).expect(201);
      internalFileId = res.body.files.find((x: any) => x.fileName === 'server-log.txt').id;
      expect(res.body.files.find((x: any) => x.id === internalFileId)).toMatchObject({ isInternal: true, commentId: noteId });
    });

    it('client users never see them listed', async () => {
      for (const u of [f.users.clientA, f.users.clientA2]) {
        const body = (await get(u, `/client-portal/tickets/${f.tickets.tA1}`).expect(200)).body;
        expect(body.files.map((x: any) => x.id)).not.toContain(internalFileId);
        expect(JSON.stringify(body)).not.toContain('server-log');
      }
    });

    it('client users cannot download them; the team can', async () => {
      await get(f.users.clientA, `/client-portal/attachments/${internalFileId}`).expect(404);
      const res = await get(f.users.devA, `/client-portal/attachments/${internalFileId}`).expect(200);
      expect(res.text).toBe('SECRET LOG LINE');
    });

    it("files can only be added to the caller's own reply", async () => {
      await upload(f.users.clientA, f.tickets.tA1, [['x.png', PNG]], noteId).expect(404);
      await upload(f.users.pm, f.tickets.tA1, [['x.png', PNG]], noteId).expect(404);
      await upload(f.users.devA, f.tickets.tA2, [['x.png', PNG]], noteId).expect(404);
    });
  });

  describe('downloading', () => {
    let pngId: number;
    let pdfId: number;

    beforeAll(async () => {
      const body = (await get(f.users.clientA, `/client-portal/tickets/${f.tickets.tA1}`).expect(200)).body;
      pngId = body.files.find((x: any) => x.fileName === 'screen.png').id;
      pdfId = body.files.find((x: any) => x.fileName === 'report.pdf').id;
    });

    it('serves the exact bytes with safe headers; images inline, others as downloads', async () => {
      const png = await get(f.users.clientA2, `/client-portal/attachments/${pngId}`).buffer(true).expect(200);
      expect(Buffer.compare(png.body, PNG)).toBe(0);
      expect(png.headers['content-type']).toBe('image/png');
      expect(png.headers['content-disposition']).toMatch(/^inline;/);
      expect(png.headers['x-content-type-options']).toBe('nosniff');
      expect(png.headers['content-security-policy']).toContain('sandbox');
      const pdf = await get(f.users.devA, `/client-portal/attachments/${pdfId}`).expect(200);
      expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="report.pdf"/);
    });

    it("another client's users, other teams and outsiders get not-found", async () => {
      for (const u of [f.users.clientB, f.users.qaB, f.users.devNone, f.users.exec, f.users.clientC, f.users.legacyClient, f.users.pmT2]) {
        await get(u, `/client-portal/attachments/${pngId}`).expect(404);
      }
      await get(f.users.pm, `/client-portal/attachments/${pngId}`).expect(200);
      await get(f.users.clientA, '/client-portal/attachments/999999').expect(404);
    });
  });

  it('client users cannot upload to a closed ticket', async () => {
    await request(app.getHttpServer()).patch(`/client-portal/tickets/${f.tickets.tA2}`).set(auth(f.users.devA)).send({ status: 'closed' }).expect(200);
    await upload(f.users.clientA2, f.tickets.tA2, [['x.png', PNG]]).expect(400);
  });
});
