import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Artifact types Stage 4 (2026-11-06): the submit menus come from the
// table. A role with no rules keeps exactly the menu it had before (user's
// choice), new types join every default menu, renames show the new name,
// and submissions accept any table type the role may use.
describe('Artifact menus from the table (e2e)', () => {
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
  const put = (u: FixtureUser, url: string, body: any = {}) => http().put(url).set(auth(u)).send(body);
  const MENU = '/submission-checklist/artifact-menu';
  const codes = (group: any) => group.types.map((t: any) => t.code);

  const DEV_TODAY = ['APK Build', 'Build Pipeline Link', 'Deployment Report', 'Pull Request Link', 'Screenshot', 'Demo Video', 'Technical Documentation'];
  const DESIGN_TODAY = ['Design file', 'Prototype', 'Design spec', 'Screenshot', 'Demo Video'];
  const OTHER_TODAY = ['APK Build', 'Build Pipeline Link', 'Deployment Report', 'Pull Request Link', 'Technical Documentation'];

  const typeId = async (code: string) => {
    await get(f.users.pm, '/submission-checklist/artifact-types').expect(200);
    return (await ds.query(`SELECT id FROM artifact_types WHERE "tenantId" = $1 AND code = $2`, [f.tenants.t1, code]))[0].id as number;
  };
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
      title: `Menu task ${seq}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
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
  const qaSubmit = (id: number, types: string[]) =>
    post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Done</p>', actualHours: 2, artifacts: types.map((type) => ({ type, url: 'https://example.com/x' })) });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_dependency_tickets, task_blocking_defects, artifact_types, artifact_type_rules, audit_logs, team_settings RESTART IDENTITY CASCADE`,
    );
    await ds.query(`UPDATE projects SET "submissionChecklistEnabled" = false, "pmReviewEnabled" = false`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('with no rules, every role gets exactly the menu it had before', async () => {
    const { body } = await get(f.users.devA, MENU).expect(200);
    expect(body.menus.developer.hasRules).toBe(false);
    expect(body.menus.developer.groups).toHaveLength(1);
    expect(body.menus.developer.groups[0].label).toBeNull();
    expect(codes(body.menus.developer.groups[0])).toEqual(DEV_TODAY);
    expect(body.menus.devops.groups.map(codes)).toEqual([DEV_TODAY]);
    expect(body.menus.designer.groups.map((g: any) => g.label)).toEqual(['Design', 'Other']);
    expect(body.menus.designer.groups.map(codes)).toEqual([DESIGN_TODAY, OTHER_TODAY]);
    expect(body.menus.developer.groups[0].types.every((t: any) => t.label === t.code && t.required === false)).toBe(true);
    // Any signed-in user may read it.
    await get(f.users.qaB, MENU).expect(200);
  });

  it('new types join every default menu; renames keep their group; inactive types leave the menus', async () => {
    await post(f.users.pm, '/submission-checklist/artifact-types', { label: 'Figma board' }).expect(201);
    await patch(f.users.pm, `/submission-checklist/artifact-types/${await typeId('Prototype')}`, { label: 'Clickable prototype' }).expect(200);
    let { body } = await get(f.users.devA, MENU).expect(200);
    expect(codes(body.menus.developer.groups[0])).toEqual([...DEV_TODAY, 'Figma board']);
    expect(body.menus.designer.groups.map(codes)).toEqual([DESIGN_TODAY, [...OTHER_TODAY, 'Figma board']]);
    expect(body.menus.designer.groups[0].types[1]).toEqual({ code: 'Prototype', label: 'Clickable prototype', required: false });

    await patch(f.users.pm, `/submission-checklist/artifact-types/${await typeId('APK Build')}`, { active: false }).expect(200);
    ({ body } = await get(f.users.devA, MENU).expect(200));
    expect(codes(body.menus.developer.groups[0])).not.toContain('APK Build');
    // Still listed (inactive) so past submissions show the right name.
    expect(body.types.find((t: any) => t.code === 'APK Build')).toEqual({ code: 'APK Build', label: 'APK Build', active: false });
    await patch(f.users.pm, `/submission-checklist/artifact-types/${await typeId('APK Build')}`, { active: true }).expect(200);
  });

  it('a role with rules gets only its offered types, in list order, with required flags', async () => {
    await put(f.users.pm, '/submission-checklist/artifact-rules/devops', {
      rules: [
        { artifactTypeId: await typeId('Deployment Report'), requirement: 'required' },
        { artifactTypeId: await typeId('Build Pipeline Link'), requirement: 'optional' },
      ],
    }).expect(200);
    const { body } = await get(f.users.devA, MENU).expect(200);
    expect(body.menus.devops).toEqual({
      hasRules: true,
      groups: [
        {
          label: null,
          types: [
            { code: 'Build Pipeline Link', label: 'Build Pipeline Link', required: false },
            { code: 'Deployment Report', label: 'Deployment Report', required: true },
          ],
        },
      ],
    });
    expect(codes(body.menus.developer.groups[0])).toEqual([...DEV_TODAY, 'Figma board']);
  });

  it('submissions accept new types; refuse unknown, inactive and not-offered ones', async () => {
    const id = await newTask();
    const unknown = await qaSubmit(id, ['Napkin sketch']).expect(400);
    expect(unknown.body.message).toBe('"Napkin sketch" is not an artifact type - pick one from the list.');
    await patch(f.users.pm, `/submission-checklist/artifact-types/${await typeId('Figma board')}`, { active: false }).expect(200);
    const inactive = await qaSubmit(id, ['Figma board']).expect(400);
    expect(inactive.body.message).toBe('"Figma board" is no longer used - pick another artifact type.');
    await patch(f.users.pm, `/submission-checklist/artifact-types/${await typeId('Figma board')}`, { active: true }).expect(200);
    await qaSubmit(id, ['Figma board', 'Screenshot']).expect(201);
    const stored = await ds.query(
      `SELECT a.type FROM task_qa_review_artifacts a JOIN task_qa_reviews r ON r.id = a."taskQaReviewId" WHERE r."taskId" = $1 ORDER BY a.type`,
      [id],
    );
    expect(stored.map((r: any) => r.type)).toEqual(['Figma board', 'Screenshot']);

    await put(f.users.pm, '/submission-checklist/artifact-rules/developer', { rules: [{ artifactTypeId: await typeId('Pull Request Link'), requirement: 'optional' }] }).expect(200);
    const notOffered = await qaSubmit(await newTask(), ['Screenshot']).expect(400);
    expect(notOffered.body.message).toBe('"Screenshot" is not an artifact type for your role - pick one from the list.');
    await qaSubmit(await newTask(), ['Pull Request Link']).expect(201);
    await put(f.users.pm, '/submission-checklist/artifact-rules/developer', { rules: [] }).expect(200);
  });

  it('checklist settings accept table types and refuse unknown ones', async () => {
    const current = (await get(f.users.pm, '/submission-checklist/settings').expect(200)).body.settings;
    const ok = await patch(f.users.pm, '/submission-checklist/settings', { ...current, evidenceArtifactTypes: ['Screenshot', 'Figma board'] }).expect(200);
    expect(ok.body.evidenceArtifactTypes).toEqual(['Screenshot', 'Figma board']);
    const bad = await patch(f.users.pm, '/submission-checklist/settings', { ...current, linkArtifactTypes: ['Napkin sketch'] }).expect(400);
    expect(bad.body.message).toBe('Unknown artifact type: "Napkin sketch".');
  });
});
