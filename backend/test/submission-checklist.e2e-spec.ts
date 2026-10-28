import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Developer submission checklist, defect triage Stage 2 (2026-10-27).
describe('Submission checklist (e2e)', () => {
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
  const upload = (u: FixtureUser, url: string) => http().post(url).set(auth(u)).attach('files', PNG, 'shot.png');
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);
  const latestRound = async (id: number) => (await ds.query(`SELECT * FROM task_qa_reviews WHERE "taskId" = $1 ORDER BY id DESC LIMIT 1`, [id]))[0];

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
      title: `Checklist ticket ${seq}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
      assigneeUserId: f.users.devA.id,
      assigneeEmail: f.users.devA.email,
      createdByUserId: f.users.qaB.id,
      createdByEmail: f.users.qaB.email,
      ...values,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return res[0].id as number;
  };
  const newDefect = () => newTask({ isDefect: true });

  const PR = { type: 'Pull Request Link', url: 'https://example.com/pr/1' };
  const SHOT = { type: 'Screenshot', url: 'https://example.com/shot.png' };
  const DOC = { type: 'Technical Documentation', url: 'https://example.com/doc' };
  const COMPLETE = {
    rootCause: 'missed requirement',
    testSteps: 'Open claims, save a claim with no date, check the error',
    affectedAreas: 'Claims list and the claim export',
    build: '2.4.1-rc3',
    environment: 'QA / Test',
    confirmedBuild: true,
  };
  const submit = (id: number, body: any = {}) =>
    post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed the date check</p>', actualHours: 2, artifacts: [PR, SHOT], ...body });
  const switchOn = (enabled: boolean, projectId = f.projects.pLms) => patch(f.users.pm, `/submission-checklist/projects/${projectId}`, { enabled }).expect(200);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    // task_dependency_tickets too: another suite's tickets (no FK to tasks)
    // would block these tasks' submissions.
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_qa_review_attachments, task_dependency_tickets, audit_logs, team_settings RESTART IDENTITY CASCADE`);
    await ds.query(`UPDATE projects SET "submissionChecklistEnabled" = false, "pmReviewEnabled" = false`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'Medical Claim', 'UAT') RETURNING id`,
        [f.tenants.t1, f.projects.pLms, f.modules.mA],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('off (the default): submissions work as before, nothing stored', async () => {
    const id = await newDefect();
    await submit(id, { artifacts: [DOC] }).expect(201);
    expect((await latestRound(id)).submissionChecklist).toBeNull();
  });

  it('only Admin / Program Manager switch it or read the settings', async () => {
    await patch(f.users.devA, `/submission-checklist/projects/${f.projects.pLms}`, { enabled: true }).expect(403);
    await get(f.users.qaB, '/submission-checklist/settings').expect(403);
    await switchOn(true);
    const opts = (await get(f.users.devA, '/submission-checklist/options').expect(200)).body;
    expect(opts.enabledProjectIds).toEqual([f.projects.pLms]);
    expect(opts.rootCauses.at(-1)).toEqual({ label: 'Other (explain)', needsNote: true });
    expect(opts.environments).toContain('QA / Test');
  });

  it('a defect with nothing filled in is refused, naming every missing item', async () => {
    const id = await newDefect();
    const res = await submit(id, { artifacts: [DOC] }).expect(400);
    for (const part of ['Root cause', 'What changed - link', 'How to test - steps', 'Evidence of self-test', 'Areas possibly affected', 'Build and environment confirmation']) {
      expect(res.body.message).toContain(part);
    }
    expect(await latestRound(id)).toBeUndefined();
  });

  it('a task never needs a root cause', async () => {
    const id = await newTask();
    const res = await submit(id, { artifacts: [DOC] }).expect(400);
    expect(res.body.message).not.toContain('Root cause');
    await submit(id, { checklist: { ...COMPLETE, rootCause: undefined } }).expect(201);
  });

  it('a complete defect checklist is stored on the round with the list text', async () => {
    const id = await newDefect();
    await submit(id, { checklist: COMPLETE }).expect(201);
    const c = (await latestRound(id)).submissionChecklist;
    expect(c.kind).toBe('defect');
    expect(c.rootCause).toBe('Missed requirement');
    expect(c.linkArtifactTypes).toEqual(['Pull Request Link']);
    expect(c.evidenceArtifactTypes).toEqual(['Screenshot']);
    expect(c.environment).toBe('QA / Test');
  });

  it('"Other (explain)" needs a note; "None expected" replaces areas; the environment must be on the list', async () => {
    const id = await newDefect();
    const other = await submit(id, { checklist: { ...COMPLETE, rootCause: 'Other (explain)' } }).expect(400);
    expect(other.body.message).toContain('Root cause note');
    const env = await submit(id, { checklist: { ...COMPLETE, environment: 'Mars' } }).expect(400);
    expect(env.body.message).toContain('Environment (pick one from the list');
    const unticked = await submit(id, { checklist: { ...COMPLETE, confirmedBuild: false } }).expect(400);
    expect(unticked.body.message).toContain('confirmation tick');
    await submit(id, {
      checklist: { ...COMPLETE, rootCause: 'Other (explain)', rootCauseNote: 'A cache in the gateway', affectedAreas: '', noAreasAffected: true },
    }).expect(201);
    expect((await latestRound(id)).submissionChecklist.noAreasAffected).toBe(true);
  });

  it('pasted screenshots count as evidence; only the submitter attaches them, to the pending round', async () => {
    const id = await newDefect();
    await submit(id, { artifacts: [PR], checklist: COMPLETE }).expect(400);
    await submit(id, { artifacts: [PR], checklist: { ...COMPLETE, selfTestScreenshots: 1 } }).expect(201);
    const round = await latestRound(id);
    await upload(f.users.pm, `/tasks/${id}/qa-reviews/${round.id}/attachments`).expect(403);
    await upload(f.users.devA, `/tasks/${id}/qa-reviews/${round.id}/attachments`).expect(201);
    const list = (await get(f.users.qaB, `/tasks/${id}/qa-review-attachments`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].uploadedByUserId).toBe(f.users.devA.id);

    // A round with no screenshots promised takes none from the developer.
    const other = await newDefect();
    await submit(other, { checklist: COMPLETE }).expect(201);
    await upload(f.users.devA, `/tasks/${other}/qa-reviews/${(await latestRound(other)).id}/attachments`).expect(403);
  });

  it('settings decide what is required, and "Submission incomplete" is a Not ready reason', async () => {
    const page = (await get(f.users.pm, '/submission-checklist/settings').expect(200)).body;
    await patch(f.users.pm, '/submission-checklist/settings', { ...page.settings, rootCauses: [{ label: ' ', needsNote: false }] }).expect(400);
    await patch(f.users.pm, '/submission-checklist/settings', { ...page.settings, evidenceArtifactTypes: [] }).expect(400);
    const saved = (
      await patch(f.users.admin, '/submission-checklist/settings', {
        ...page.settings,
        required: { defect: page.settings.required.defect, task: ['rootCause', 'testData'] },
      }).expect(200)
    ).body;
    expect(saved.required.task).toEqual(['testData']);
    const id = await newTask();
    const res = await submit(id, { artifacts: [DOC] }).expect(400);
    expect(res.body.message).toBe('The submission checklist is not complete. Missing: How to test - test data (at least 10 characters).');
    await patch(f.users.pm, '/submission-checklist/settings', page.settings).expect(200);

    const reasons = (await get(f.users.qaB, '/qa-review/not-ready-reasons').expect(200)).body.reasons;
    expect(reasons).toContain('Submission incomplete');
  });

  it('with PM review on, the checklist is checked at the developer submit and kept on the PM round', async () => {
    await ds.query(`UPDATE projects SET "pmReviewEnabled" = true WHERE id = $1`, [f.projects.pLms]);
    const id = await newTask();
    await submit(id, { artifacts: [PR] }).expect(400);
    await submit(id, { checklist: COMPLETE }).expect(201);
    const round = await latestRound(id);
    expect(round.reviewType).toBe('pm');
    expect(round.submissionChecklist.kind).toBe('task');
    await ds.query(`UPDATE projects SET "pmReviewEnabled" = false WHERE id = $1`, [f.projects.pLms]);
  });

  it('switching off goes back to the old rules', async () => {
    await switchOn(false);
    const id = await newDefect();
    await submit(id, { artifacts: [DOC] }).expect(201);
  });
});
