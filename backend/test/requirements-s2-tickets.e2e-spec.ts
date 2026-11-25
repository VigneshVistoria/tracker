import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { addTask, addUser, seedRequirements, storyIn } from './setup/requirements';
import { REQUIREMENTS_AUDIT } from '../src/requirements/requirements';

// Requirements traceability Stage 2 (2026-11-25): linking Tracker tickets to
// stories, moving / unlinking them, the "Map existing tickets" screen,
// suggestions from a ticket's Requirement ID, and the unmapped list. Linking
// must never change the ticket or anything the performance figures read.
//
// Every test starts from the same known state (beforeEach: no links, the
// same three Approved stories, empty audit log) and creates the links it
// needs itself, so no test depends on another one having run or passed.
// The file removes everything it created when it finishes (afterAll).
describe('Requirements Stage 2 - tickets (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let srsId: number;
  let ba: FixtureUser;
  let t1: number;
  let t2: number;
  let t3: number;
  let tOther: number;
  let tJunk: number;
  let snapshot: { tasks: any[]; events: any[] };

  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const http = () => request(app.getHttpServer());
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const del = (u: FixtureUser, url: string) => http().delete(url).set(auth(u));
  const tree = async () => (await get(f.users.pm, `/requirements/srs/${srsId}/tree`).expect(200)).body;
  const storyId = async (code: string) => (await ds.query(`SELECT id FROM srs_stories WHERE code = $1`, [code]))[0].id as number;
  const criteriaOf = async (code: string) => (await ds.query(`SELECT c.id FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s.code = $1 ORDER BY c.position`, [code])).map((r: any) => r.id);
  // Links a ticket through the real API (as the PM) - test setup.
  const linkAs = async (code: string, taskId: number, kinds: string[], criterionIds: number[] = []) =>
    (await post(f.users.pm, `/requirements/stories/${await storyId(code)}/tickets`, { taskId, kinds, criterionIds }).expect(201)).body;
  const APPROVED = ['US-02', 'US-03', 'US-05'];
  // The known starting state for every test.
  const resetState = async () => {
    await ds.query(`DELETE FROM srs_ticket_criteria`);
    await ds.query(`DELETE FROM srs_story_tickets`);
    await ds.query(`UPDATE srs_stories SET status = 'draft', "approvedByUserId" = NULL, "approvedAt" = NULL WHERE "srsId" = $1`, [srsId]);
    await ds.query(`UPDATE srs_stories SET status = 'approved', "approvedByUserId" = $2, "approvedAt" = now() WHERE "srsId" = $1 AND code = ANY($3)`, [srsId, f.users.pm.id, APPROVED]);
    await ds.query(`DELETE FROM audit_logs`);
  };
  const takeSnapshot = async () => ({
    tasks: await ds.query(`SELECT * FROM project_tasks WHERE id = ANY($1) ORDER BY id`, [[t1, t2, t3, tOther, tJunk]]),
    events: await ds.query(`SELECT * FROM task_status_events ORDER BY id`),
  });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE team_settings, audit_logs RESTART IDENTITY CASCADE`);
    srsId = await seedRequirements(ds, f, { clientItems: false });
    ba = await addUser(ds, f, 'ba', 'ba', [f.projects.pLms]);
    t1 = await addTask(ds, f, f.projects.pLms, 'Lien approval and deed lock', { requirementId: 'US-03' });
    t2 = await addTask(ds, f, f.projects.pLms, 'Consent upload', { requirementId: 'ln-10, LN-11' });
    t3 = await addTask(ds, f, f.projects.pLms, 'Unrelated LMS work', { status: 'Backlog' });
    tOther = await addTask(ds, f, f.projects.pA, 'Other project work', { requirementId: 'US-03' });
    tJunk = await addTask(ds, f, f.projects.pLms, 'Junked', { status: 'Junk', requirementId: 'US-03' });
    await http().put('/requirements/settings').set(auth(f.users.pm)).send({ requirementsTree: true }).expect(200);
    snapshot = await takeSnapshot();
  });

  // US-02, US-03, US-05 approved (as if after client sign-off), nothing linked.
  beforeEach(resetState);

  // Leave nothing behind for the next test file.
  afterAll(async () => {
    if (ds) {
      await resetState();
      await ds.query(`UPDATE srs_stories SET status = 'draft', "approvedByUserId" = NULL, "approvedAt" = NULL WHERE "srsId" = $1`, [srsId]);
      await ds.query(`DELETE FROM project_tasks WHERE id = ANY($1)`, [[t1, t2, t3, tOther, tJunk].filter(Boolean)]);
      await ds.query(`DELETE FROM user_projects WHERE "usersId" = $1`, [ba?.id ?? 0]);
      await ds.query(`DELETE FROM users WHERE id = $1`, [ba?.id ?? 0]);
      await ds.query(`DELETE FROM team_settings WHERE "tenantId" = $1`, [f.tenants.t1]);
    }
    await app?.close();
  });

  it('only PM/Admin link, only to working stories, only tickets of this project and not Junk', async () => {
    const us03 = await storyId('US-03');
    for (const u of [ba, f.users.qaB, f.users.exec, f.users.devA]) await post(u, `/requirements/stories/${us03}/tickets`, { taskId: t1, kinds: ['dev'] }).expect(403);
    await post(f.users.pm, `/requirements/stories/${await storyId('US-04')}/tickets`, { taskId: t1, kinds: ['dev'] }).expect(400); // Draft
    expect((await post(f.users.pm, `/requirements/stories/${us03}/tickets`, { taskId: tOther, kinds: ['dev'] }).expect(400)).body.message).toMatch(/not in this SRS's project/);
    expect((await post(f.users.pm, `/requirements/stories/${us03}/tickets`, { taskId: tJunk, kinds: ['dev'] }).expect(400)).body.message).toMatch(/Junk/);
    await post(f.users.pm, `/requirements/stories/${us03}/tickets`, { taskId: 999999, kinds: ['dev'] }).expect(404);
    await post(f.users.pm, `/requirements/stories/${us03}/tickets`, { taskId: t1, kinds: ['ux'] }).expect(400);
  });

  it('look up a TRK number on a story', async () => {
    const us03 = await storyId('US-03');
    const found = (await get(f.users.pm, `/requirements/stories/${us03}/ticket-lookup?trk=trk-${t1}`).expect(200)).body;
    expect(found).toMatchObject({ taskId: t1, trk: `TRK-${t1}`, title: 'Lien approval and deed lock', status: 'Development', assignee: 'Name devA', links: [] });
    await get(f.users.pm, `/requirements/stories/${us03}/ticket-lookup?trk=hello`).expect(400);
    await get(f.users.pm, `/requirements/stories/${us03}/ticket-lookup?trk=${tOther}`).expect(400);
  });

  it('link a ticket as Dev and QA with the criteria it covers: story moves to In progress; duplicates refused; audited', async () => {
    const us03 = await storyId('US-03');
    const [c1, c2] = await criteriaOf('US-03');
    const [x] = await criteriaOf('US-02');
    await post(f.users.pm, `/requirements/stories/${us03}/tickets`, { taskId: t1, kinds: ['dev'], criterionIds: [x] }).expect(400); // not this story's criterion
    const res = (await post(f.users.pm, `/requirements/stories/${us03}/tickets`, { taskId: t1, kinds: ['dev', 'qa'], criterionIds: [c1, c2] }).expect(201)).body;
    expect(res.created.map((c: any) => c.kind)).toEqual(['dev', 'qa']);
    expect(res.storyStatus).toBe('in_progress');
    await post(f.users.admin, `/requirements/stories/${us03}/tickets`, { taskId: t1, kinds: ['dev'] }).expect(409);
    const s = storyIn(await tree(), 'US-03');
    expect(s.tickets.map((t: any) => [t.trk, t.kind, t.criterionIds])).toEqual([
      [`TRK-${t1}`, 'dev', [c1, c2]],
      [`TRK-${t1}`, 'qa', [c1, c2]],
    ]);
    expect(s).toMatchObject({ status: 'in_progress', state: 'progress' });
    const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = $1 ORDER BY id`, [REQUIREMENTS_AUDIT.TICKET_LINKED]);
    expect(audit.map((a: any) => JSON.parse(a.details).kind)).toEqual(['dev', 'qa']);
  });

  it('move a link to another working story (its criteria are dropped); unlink; audited', async () => {
    const [c1, c2] = await criteriaOf('US-03');
    await linkAs('US-03', t1, ['dev', 'qa'], [c1, c2]);
    const s = storyIn(await tree(), 'US-03');
    const qaLink = s.tickets.find((t: any) => t.kind === 'qa');
    await post(f.users.pm, `/requirements/story-tickets/${qaLink.linkId}/move`, { storyId: await storyId('US-04') }).expect(400); // Draft
    await post(ba, `/requirements/story-tickets/${qaLink.linkId}/move`, { storyId: await storyId('US-05') }).expect(403);
    await post(f.users.pm, `/requirements/story-tickets/${qaLink.linkId}/move`, { storyId: await storyId('US-05') }).expect(201);
    let t = await tree();
    expect(storyIn(t, 'US-05').tickets).toEqual([expect.objectContaining({ trk: `TRK-${t1}`, kind: 'qa', criterionIds: [] })]);
    expect(storyIn(t, 'US-05').status).toBe('in_progress');
    expect(storyIn(t, 'US-03').tickets.map((x: any) => x.kind)).toEqual(['dev']);
    const [m] = await ds.query(`SELECT details FROM audit_logs WHERE action = $1`, [REQUIREMENTS_AUDIT.TICKET_MOVED]);
    expect(JSON.parse(m.details)).toMatchObject({ from: 'US-03', to: 'US-05', kind: 'qa' });

    await del(f.users.qaB, `/requirements/story-tickets/${qaLink.linkId}`).expect(403);
    await del(f.users.pm, `/requirements/story-tickets/${qaLink.linkId}`).expect(200);
    t = await tree();
    expect(storyIn(t, 'US-05')).toMatchObject({ tickets: [], status: 'approved' });
    expect((await ds.query(`SELECT count(*)::int n FROM audit_logs WHERE action = $1`, [REQUIREMENTS_AUDIT.TICKET_UNLINKED]))[0].n).toBe(1);
  });

  it('map screen: filters, mapped / unmapped, never other projects or Junk', async () => {
    await linkAs('US-03', t1, ['dev']);
    const all = (await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets`).expect(200)).body;
    expect(all.tickets.map((t: any) => t.taskId).sort()).toEqual([t1, t2, t3].sort());
    expect(all.statuses.sort()).toEqual(['Backlog', 'Development']);
    expect(all.assignees).toEqual([{ id: f.users.devA.id, name: 'Name devA' }]);
    const unmapped = (await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?mapped=unmapped`).expect(200)).body;
    expect(unmapped.tickets.map((t: any) => t.taskId).sort()).toEqual([t2, t3].sort());
    const mapped = (await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?mapped=mapped`).expect(200)).body;
    expect(mapped.tickets).toEqual([expect.objectContaining({ taskId: t1, links: [expect.objectContaining({ code: 'US-03', kind: 'dev' })] })]);
    expect((await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?q=consent`).expect(200)).body.tickets.map((t: any) => t.taskId)).toEqual([t2]);
    expect((await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?q=TRK-${t3}`).expect(200)).body.tickets.map((t: any) => t.taskId)).toEqual([t3]);
    expect((await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?status=Backlog`).expect(200)).body.tickets.map((t: any) => t.taskId)).toEqual([t3]);
    expect((await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?q=%25`).expect(200)).body.tickets).toEqual([]);
    for (const u of [ba, f.users.qaB, f.users.exec]) await get(u, `/requirements/srs/${srsId}/map/tickets`).expect(403);
  });

  it('suggestions from the Requirement ID: story code or traced requirement, never linked automatically', async () => {
    // Before t1 is linked, its Requirement ID (US-03) suggests US-03.
    const before = (await get(f.users.pm, `/requirements/srs/${srsId}/map/suggestions`).expect(200)).body;
    expect(before.suggestions.map((sg: any) => [sg.taskId, sg.stories.map((x: any) => x.code)])).toEqual([
      [t2, ['US-02']],
      [t1, ['US-03']],
    ]);
    await linkAs('US-03', t1, ['dev']);
    const res = (await get(f.users.pm, `/requirements/srs/${srsId}/map/suggestions`).expect(200)).body;
    // t1 names US-03 but is already linked to it; t2 names LN-10/LN-11 -> US-02 (approved). Other project / Junk never appear.
    expect(res.suggestions).toEqual([expect.objectContaining({ taskId: t2, stories: [expect.objectContaining({ code: 'US-02', via: 'LN-10' })] })]);
    expect((await ds.query(`SELECT count(*)::int n FROM srs_story_tickets WHERE "taskId" = $1`, [t2]))[0].n).toBe(0);
  });

  it('map many tickets to one Approved story in one go; already-linked kinds are skipped and reported', async () => {
    await linkAs('US-03', t1, ['dev']);
    const us02 = await storyId('US-02');
    const [c1] = await criteriaOf('US-02');
    await post(f.users.pm, `/requirements/srs/${srsId}/map`, { taskIds: [t2], storyId: await storyId('US-04'), kinds: ['dev'] }).expect(400); // Draft
    await post(f.users.pm, `/requirements/srs/${srsId}/map`, { taskIds: [t2, tOther], storyId: us02, kinds: ['dev'] }).expect(400); // whole request refused
    expect((await ds.query(`SELECT count(*)::int n FROM srs_story_tickets WHERE "storyId" = $1`, [us02]))[0].n).toBe(0);
    const first = (await post(f.users.pm, `/requirements/srs/${srsId}/map`, { taskIds: [t2], storyId: us02, kinds: ['dev'], criterionIds: [c1] }).expect(201)).body;
    expect(first).toMatchObject({ story: 'US-02', linked: [`TRK-${t2} (DEV)`], skipped: [], storyStatus: 'in_progress' });
    const second = (await post(f.users.pm, `/requirements/srs/${srsId}/map`, { taskIds: [t2, t3], storyId: us02, kinds: ['dev', 'qa'] }).expect(201)).body;
    expect(second.linked.sort()).toEqual([`TRK-${t2} (QA)`, `TRK-${t3} (DEV)`, `TRK-${t3} (QA)`].sort());
    expect(second.skipped).toEqual([`TRK-${t2} (DEV)`]);
    expect((await get(f.users.pm, `/requirements/srs/${srsId}/map/suggestions`).expect(200)).body.suggestions).toEqual([]);
    expect((await get(f.users.pm, `/requirements/srs/${srsId}/map/tickets?mapped=unmapped`).expect(200)).body.tickets).toEqual([]);
  });

  it('linking, moving, unlinking and mapping never change any ticket or any status event the performance figures read', async () => {
    const [c1] = await criteriaOf('US-03');
    await linkAs('US-03', t1, ['dev', 'qa'], [c1]);
    const qaLink = storyIn(await tree(), 'US-03').tickets.find((t: any) => t.kind === 'qa');
    await post(f.users.pm, `/requirements/story-tickets/${qaLink.linkId}/move`, { storyId: await storyId('US-05') }).expect(201);
    await del(f.users.pm, `/requirements/story-tickets/${qaLink.linkId}`).expect(200);
    await post(f.users.pm, `/requirements/srs/${srsId}/map`, { taskIds: [t2, t3], storyId: await storyId('US-02'), kinds: ['dev', 'qa'] }).expect(201);
    expect((await ds.query(`SELECT count(*)::int n FROM srs_story_tickets`))[0].n).toBe(5);
    expect(await takeSnapshot()).toEqual(snapshot);
  });
});
