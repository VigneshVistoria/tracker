import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { addUser, seedRequirements, storyIn } from './setup/requirements';
import { REQUIREMENTS_AUDIT } from '../src/requirements/requirements';
import { EventsGateway } from '../src/events/events.gateway';

// Requirements traceability Stage 2 (2026-11-25): the BA role and its
// access fix, epics / stories / criteria, approval with the client
// sign-off gate, client sign-off, and open client items.
describe('Requirements Stage 2 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let srsId: number;
  let ba: FixtureUser;
  let baOff: FixtureUser;

  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const http = () => request(app.getHttpServer());
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any) => http().patch(url).set(auth(u)).send(body);
  const del = (u: FixtureUser, url: string) => http().delete(url).set(auth(u));
  const put = (u: FixtureUser, url: string, body: any) => http().put(url).set(auth(u)).send(body);
  const tree = async (u: FixtureUser = f.users.pm) => (await get(u, `/requirements/srs/${srsId}/tree`).expect(200)).body;
  const storyId = async (code: string) => (await ds.query(`SELECT id FROM srs_stories WHERE code = $1`, [code]))[0].id as number;
  const epicId = async (code: string) => (await ds.query(`SELECT id FROM srs_epics WHERE code = $1 AND "deletedAt" IS NULL`, [code]))[0].id as number;
  const audits = async (action: string) => ds.query(`SELECT "userId", "entityId", details FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE team_settings, audit_logs RESTART IDENTITY CASCADE`);
    srsId = await seedRequirements(ds, f);
    ba = await addUser(ds, f, 'ba', 'ba', [f.projects.pLms]);
    baOff = await addUser(ds, f, 'baOff', 'ba', [f.projects.pB]);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('BA role', () => {
    it('only while the switch is ON can an Admin give someone the BA role', async () => {
      await post(f.users.admin, '/users', { email: 'newba@test.local', password: 'Password123!', fullName: 'New BA', role: 'ba' }).expect(400);
      await patch(f.users.admin, `/users/${f.users.devNone.id}`, { role: 'ba' }).expect(400);
      expect((await ds.query(`SELECT role::text AS role FROM users WHERE id = $1`, [f.users.devNone.id]))[0].role).toBe('developer');
      await put(f.users.pm, '/requirements/settings', { requirementsTree: true }).expect(200);
      const created = (await post(f.users.admin, '/users', { email: 'newba@test.local', password: 'Password123!', fullName: 'New BA', role: 'ba' }).expect(201)).body;
      expect(created.role).toBe('ba');
      // Other edits of an existing BA are fine either way.
      await put(f.users.pm, '/requirements/settings', { requirementsTree: false }).expect(200);
      await patch(f.users.admin, `/users/${created.id}`, { fullName: 'New BA 2', role: 'ba' }).expect(200);
      await put(f.users.pm, '/requirements/settings', { requirementsTree: true }).expect(200);
    });

    it('a BA can use Requirements (their projects only) and nothing else', async () => {
      expect((await get(ba, '/requirements/me').expect(200)).body).toMatchObject({ on: true, canView: true, canRecordResults: false, isBa: true });
      expect((await get(ba, '/requirements/srs').expect(200)).body.map((d: any) => d.id)).toEqual([srsId]);
      await get(ba, `/requirements/srs/${srsId}/tree`).expect(200);
      expect((await get(baOff, '/requirements/srs').expect(200)).body).toEqual([]);
      await get(baOff, `/requirements/srs/${srsId}/tree`).expect(404);
      // The app frame's per-user calls still work.
      await get(ba, '/notifications/unread-count').expect(200);
      await get(ba, '/client-portal/me').expect(200);
      await get(ba, '/own-metrics-visibility/me').expect(200);
      // Everything else: 403, including the places that used to treat an unknown role like a PM or developer.
      for (const url of ['/issues', '/projects', `/projects/${f.projects.pLms}`, '/users/assignable', '/users/me', '/dependencies', '/search?q=lien', '/tasks/mine', '/tasks/team', '/performance-dashboard', '/kpi/me']) {
        const res = await get(ba, url);
        expect([url, res.status]).toEqual([url, 403]);
      }
      await post(ba, '/issues', { title: 'x', description: 'x' }).expect(403);
      // Nobody else is affected.
      await get(f.users.devA, '/projects').expect(200);
      await get(f.users.qaB, '/issues').expect(200);
    });

    it('a BA cannot record Pass/Fail, approve, link tickets or record client sign-off', async () => {
      const [c] = await ds.query(`SELECT c.id FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s.code = 'US-03' AND c.position = 1`);
      await put(ba, `/requirements/criteria/${c.id}/result`, { result: 'pass' }).expect(403);
      await post(ba, `/requirements/stories/${await storyId('US-03')}/approve`).expect(403);
      await post(ba, `/requirements/stories/${await storyId('US-03')}/approve-at-risk`, { reason: 'Client is late with sign-off' }).expect(403);
      await post(ba, `/requirements/stories/${await storyId('US-03')}/tickets`, { taskId: 1, kinds: ['dev'] }).expect(403);
      await http().post(`/requirements/srs/${srsId}/client-sign-off`).set(auth(ba)).field('clientName', 'X').field('signedOn', '2026-11-20').attach('file', PDF, 'signed.pdf').expect(403);
    });

    it('BA users never join the tenant-wide live feed', async () => {
      const gateway = app.get(EventsGateway);
      const connect = async (u: FixtureUser) => {
        const rooms: string[] = [];
        const socket: any = { id: 't', handshake: { auth: { token: tokenFor(u) } }, join: (r: string) => rooms.push(r), disconnect() {} };
        await gateway.handleConnection(socket);
        return rooms;
      };
      expect(await connect(ba)).toEqual([`user:${ba.id}`]);
      expect(await connect(f.users.pm)).toEqual([`tenant:${f.tenants.t1}`, `user:${f.users.pm.id}`]);
    });
  });

  describe('epics', () => {
    it('BA/PM/Admin create, edit and delete epics; codes are never reused; audited', async () => {
      for (const u of [f.users.exec, f.users.qaB, f.users.devA]) await post(u, `/requirements/srs/${srsId}/epics`, { name: 'Nope' }).expect(403);
      await post(ba, `/requirements/srs/${srsId}/epics`, { name: '   ' }).expect(400);
      const e7 = (await post(ba, `/requirements/srs/${srsId}/epics`, { name: 'Reporting', srsSection: 'SRS 8' }).expect(201)).body;
      expect(e7.code).toBe('E7');
      await patch(ba, `/requirements/epics/${e7.id}`, { name: 'Reports and exports' }).expect(200);
      const t = await tree();
      expect(t.epics.map((e: any) => e.code)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']);
      expect(t.epics[6]).toMatchObject({ name: 'Reports and exports', srsSection: 'SRS 8', percent: 0, stories: [] });
      await del(f.users.pm, `/requirements/epics/${await epicId('E1')}`).expect(409); // has stories
      await del(ba, `/requirements/epics/${e7.id}`).expect(200);
      expect((await post(ba, `/requirements/srs/${srsId}/epics`, { name: 'Again' }).expect(201)).body.code).toBe('E8');
      const created = await audits(REQUIREMENTS_AUDIT.EPIC_CREATED);
      expect(created).toHaveLength(2);
      expect(created[0].userId).toBe(ba.id);
      expect(JSON.parse((await audits(REQUIREMENTS_AUDIT.EPIC_UPDATED))[0].details)).toMatchObject({ code: 'E7', before: { name: 'Reporting' }, after: { name: 'Reports and exports' } });
      expect(await audits(REQUIREMENTS_AUDIT.EPIC_DELETED)).toHaveLength(1);
    });
  });

  describe('stories, approval and criteria', () => {
    let us24: number;

    it('a BA creates a Draft story traced to requirement IDs; codes are never reused', async () => {
      const reqs = (await get(ba, `/requirements/srs/${srsId}/requirements`).expect(200)).body;
      expect(reqs).toHaveLength(40);
      const ln10 = reqs.find((r: any) => r.code === 'LN-10');
      await post(ba, `/requirements/epics/${await epicId('E1')}/stories`, { title: 'x', requirementIds: [999999] }).expect(400);
      const body = (await post(ba, `/requirements/epics/${await epicId('E1')}/stories`, { title: 'Show consent status', asA: 'bank officer', iWant: 'to see consent', soThat: 'I know', requirementIds: [ln10.id] }).expect(201)).body;
      expect(body.code).toBe('US-24');
      us24 = body.id;
      const s = storyIn(await tree(), 'US-24');
      expect(s).toMatchObject({ status: 'draft', requirements: ['LN-10'], total: 0, percent: 0, canEdit: true });
      await post(f.users.exec, `/requirements/epics/${await epicId('E1')}/stories`, { title: 'x' }).expect(403);
    });

    it('a BA edits Draft stories only; edits are audited with before/after', async () => {
      await patch(ba, `/requirements/stories/${us24}`, { title: 'Show owner consent status', requirementIds: [] }).expect(200);
      const [a] = await audits(REQUIREMENTS_AUDIT.STORY_UPDATED);
      expect(JSON.parse(a.details)).toMatchObject({ code: 'US-24', before: { title: 'Show consent status', requirements: ['LN-10'] }, after: { title: 'Show owner consent status', requirements: [] } });
      // Criteria on a Draft story: BA adds, reorders.
      const c1 = (await post(ba, `/requirements/stories/${us24}/criteria`, { text: 'Consent shows as Verified or Pending' }).expect(201)).body;
      const c2 = (await post(ba, `/requirements/stories/${us24}/criteria`, { text: 'Pending consent blocks approval' }).expect(201)).body;
      expect([c1.position, c2.position]).toEqual([1, 2]);
      await put(ba, `/requirements/stories/${us24}/criteria/order`, { criterionIds: [c1.id] }).expect(400);
      await put(ba, `/requirements/stories/${us24}/criteria/order`, { criterionIds: [c2.id, c1.id] }).expect(200);
      expect(storyIn(await tree(), 'US-24').criteria.map((c: any) => c.text)).toEqual(['Pending consent blocks approval', 'Consent shows as Verified or Pending']);
    });

    it('approval needs the client sign-off; otherwise PM "Approve at risk" with a reason', async () => {
      const res = await post(f.users.pm, `/requirements/stories/${us24}/approve`).expect(400);
      expect(res.body.message).toMatch(/not signed off by the client/);
      await post(f.users.pm, `/requirements/stories/${us24}/approve-at-risk`, { reason: 'short' }).expect(400);
      expect((await post(f.users.pm, `/requirements/stories/${us24}/approve-at-risk`, { reason: 'Client sign-off meeting is next week' }).expect(201)).body).toMatchObject({ status: 'approved', atRisk: true });
      const s = storyIn(await tree(), 'US-24');
      expect(s).toMatchObject({ status: 'approved', atRisk: true, atRiskReason: 'Client sign-off meeting is next week', canRecordResults: true, canLinkTickets: true });
      expect(storyIn(await tree(ba), 'US-24').canEdit).toBe(false);
      await post(f.users.pm, `/requirements/stories/${us24}/approve`).expect(400); // already approved
      const [a] = await audits(REQUIREMENTS_AUDIT.STORY_APPROVED_AT_RISK);
      expect(JSON.parse(a.details)).toMatchObject({ code: 'US-24', reason: 'Client sign-off meeting is next week' });
    });

    it('after approval only PM/Admin edit; changing a tested criterion resets it to Not run, history kept', async () => {
      await patch(ba, `/requirements/stories/${us24}`, { title: 'BA edit' }).expect(403);
      await post(ba, `/requirements/stories/${us24}/criteria`, { text: 'BA add' }).expect(403);
      await patch(f.users.pm, `/requirements/stories/${us24}`, { soThat: 'I can follow up' }).expect(200);
      const [c] = await ds.query(`SELECT id FROM srs_criteria WHERE "storyId" = $1 AND position = 1`, [us24]);
      await put(f.users.qaB, `/requirements/criteria/${c.id}/result`, { result: 'pass' }).expect(200);
      expect(storyIn(await tree(), 'US-24').status).toBe('in_progress');
      expect((await patch(f.users.pm, `/requirements/criteria/${c.id}`, { text: 'Pending consent blocks approval and says why' }).expect(200)).body).toMatchObject({ changed: true, reset: true });
      const s = storyIn(await tree(), 'US-24');
      expect(s.criteria[0]).toMatchObject({ text: 'Pending consent blocks approval and says why', result: 'not_run' });
      expect(await ds.query(`SELECT result FROM srs_criterion_results WHERE "criterionId" = $1`, [c.id])).toEqual([{ result: 'pass' }]);
      const [a] = await audits(REQUIREMENTS_AUDIT.CRITERION_UPDATED);
      expect(JSON.parse(a.details)).toMatchObject({ story: 'US-24', criterion: 'AC1', resultReset: 'pass' });
      // A criterion with a result in its history is kept; an untested one can go (and the rest renumber).
      await del(f.users.pm, `/requirements/criteria/${c.id}`).expect(409);
      const extra = (await post(f.users.pm, `/requirements/stories/${us24}/criteria`, { text: 'Extra criterion' }).expect(201)).body;
      const [c2] = await ds.query(`SELECT id FROM srs_criteria WHERE "storyId" = $1 AND position = 2`, [us24]);
      await del(f.users.pm, `/requirements/criteria/${c2.id}`).expect(200);
      const after = storyIn(await tree(), 'US-24').criteria;
      expect(after.map((x: any) => [x.position, x.id])).toEqual([
        [1, c.id],
        [2, extra.id],
      ]);
    });

    it('delete: refused once a story has results; a fresh Draft story is soft-deleted and its code not reused', async () => {
      await del(f.users.pm, `/requirements/stories/${us24}`).expect(409);
      const fresh = (await post(ba, `/requirements/epics/${await epicId('E2')}/stories`, { title: 'Temporary' }).expect(201)).body;
      expect(fresh.code).toBe('US-25');
      await del(ba, `/requirements/stories/${fresh.id}`).expect(200);
      expect(storyIn(await tree(), 'US-25')).toBeUndefined();
      expect((await ds.query(`SELECT "deletedByUserId" FROM srs_stories WHERE id = $1`, [fresh.id]))[0].deletedByUserId).toBe(ba.id);
      expect((await post(ba, `/requirements/epics/${await epicId('E2')}/stories`, { title: 'Next' }).expect(201)).body.code).toBe('US-26');
    });

    it('the story page has the story, its requirements, history and permissions', async () => {
      const page = (await get(f.users.pm, `/requirements/stories/${us24}`).expect(200)).body;
      expect(page.story).toMatchObject({ code: 'US-24', status: 'approved', createdBy: 'Name ba', approvedBy: 'Name pm', atRisk: true });
      expect(page.story.history).toHaveLength(1);
      expect(page.epic.code).toBe('E1');
      expect(page.permissions).toMatchObject({ canEdit: true, canApprove: false });
      await get(baOff, `/requirements/stories/${us24}`).expect(404);
      await get(f.users.devA, `/requirements/stories/${us24}`).expect(403);
    });
  });

  describe('client items', () => {
    it('open items block their stories; BA/PM/Admin add, PM/Admin close with a resolution', async () => {
      let t = await tree();
      const us02 = storyIn(t, 'US-02');
      expect(us02.state).toBe('blocked');
      expect(us02.clientItems.map((i: any) => i.number)).toEqual([2]);
      expect(storyIn(t, 'US-01').clientItems.map((i: any) => i.number)).toEqual([4]);
      expect(t.summary.storiesBlocked).toBe(7);

      await post(f.users.qaB, `/requirements/srs/${srsId}/client-items`, { question: 'x' }).expect(403);
      const item = (await post(ba, `/requirements/srs/${srsId}/client-items`, { question: 'Which banks go live first?', owner: 'Client', storyIds: [await storyId('US-05')] }).expect(201)).body;
      expect(item.number).toBe(6);
      expect(storyIn(await tree(), 'US-05').state).toBe('blocked');

      const items = (await get(f.users.exec, `/requirements/srs/${srsId}/client-items`).expect(200)).body;
      expect(items.items.map((i: any) => [i.number, i.status, i.stories.map((s: any) => s.code)])).toContainEqual([4, 'open', ['US-01', 'US-11', 'US-13']]);

      const [two] = await ds.query(`SELECT id FROM srs_client_items WHERE "srsId" = $1 AND number = 2`, [srsId]);
      await post(ba, `/requirements/client-items/${two.id}/close`, { resolution: 'Legal confirmed consent route' }).expect(403);
      await post(f.users.pm, `/requirements/client-items/${two.id}/close`, { resolution: 'ok' }).expect(400);
      await post(f.users.pm, `/requirements/client-items/${two.id}/close`, { resolution: 'Legal confirmed: consent from every owner' }).expect(201);
      await post(f.users.pm, `/requirements/client-items/${two.id}/close`, { resolution: 'Legal confirmed: consent from every owner' }).expect(409);
      await patch(ba, `/requirements/client-items/${two.id}`, { owner: 'Legal' }).expect(400);
      t = await tree();
      expect(storyIn(t, 'US-02')).toMatchObject({ state: 'no_tickets', clientItems: [] });
      const [a] = await audits(REQUIREMENTS_AUDIT.CLIENT_ITEM_CLOSED);
      expect(JSON.parse(a.details)).toMatchObject({ number: 2, unblocks: ['US-02'] });
    });
  });

  describe('client sign-off', () => {
    const signOff = (u: FixtureUser, file: Buffer | null, name = 'signed.pdf', signedOn = '2026-11-20') => {
      const r = http().post(`/requirements/srs/${srsId}/client-sign-off`).set(auth(u)).field('clientName', 'Land Registry').field('signedOn', signedOn);
      return file ? r.attach('file', file, name) : r;
    };

    it('PM only, with a real signed document; then stories approve normally and At risk clears', async () => {
      for (const u of [f.users.admin, f.users.exec, f.users.qaB]) await signOff(u, PDF).expect(403);
      await signOff(f.users.pm, null).expect(400);
      expect((await signOff(f.users.pm, Buffer.from('not really a pdf'), 'signed.pdf').expect(400)).body.message).toMatch(/PDF, PNG, JPEG or Word/);
      await signOff(f.users.pm, PDF, 'signed.pdf', '2099-01-01').expect(400);
      await signOff(f.users.pm, PDF, 'signed.pdf', '2026-02-30').expect(400);
      await signOff(f.users.pm, PDF, 'Signed SRS v1.0.pdf').expect(201);
      await signOff(f.users.pm, PDF).expect(409);

      const t = await tree();
      expect(t.srs).toMatchObject({ status: 'client_signed_off', clientName: 'Land Registry', clientSignedOn: '2026-11-20', clientFileName: 'Signed SRS v1.0.pdf' });
      expect(t.permissions.canRecordClientSignOff).toBe(false);
      expect(storyIn(t, 'US-24').atRisk).toBe(false); // label clears; the reason is kept
      expect(storyIn(t, 'US-24').atRiskReason).toBe('Client sign-off meeting is next week');

      const file = await get(ba, `/requirements/srs/${srsId}/client-sign-off/file`).expect(200);
      expect(file.headers['content-type']).toMatch(/application\/pdf/);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(file.body).equals(PDF)).toBe(true);
      await get(baOff, `/requirements/srs/${srsId}/client-sign-off/file`).expect(404);

      expect((await post(f.users.pm, `/requirements/stories/${await storyId('US-03')}/approve`).expect(201)).body).toMatchObject({ status: 'approved', atRisk: false });
      await post(f.users.pm, `/requirements/stories/${await storyId('US-04')}/approve-at-risk`, { reason: 'No longer needed but tried' }).expect(400);
      const [a] = await audits(REQUIREMENTS_AUDIT.CLIENT_SIGNED_OFF);
      expect(a.userId).toBe(f.users.pm.id);
      expect(JSON.parse(a.details)).toMatchObject({ statusBefore: 'in_review', clientName: 'Land Registry', signedOn: '2026-11-20', file: 'Signed SRS v1.0.pdf' });
    });
  });

  it('with the switch OFF, a BA gets nothing at all', async () => {
    await put(f.users.pm, '/requirements/settings', { requirementsTree: false }).expect(200);
    await get(ba, '/requirements/srs').expect(404);
    await get(ba, '/projects').expect(403);
    await put(f.users.pm, '/requirements/settings', { requirementsTree: true }).expect(200);
  });
});
