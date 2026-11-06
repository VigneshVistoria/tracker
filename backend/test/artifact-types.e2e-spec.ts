import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Admin-configurable artifact types, Stage 2 (2026-11-06): the Artifact
// types section of Submission Checklist Settings. PM + Admin only, audited,
// tenants without rows get the 10 defaults on first read.
describe('Artifact types settings (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const put = (u: FixtureUser, url: string, body: any = {}) => http().put(url).set(auth(u)).send(body);
  const BASE = '/submission-checklist/artifact-types';
  const typeId = async (code: string, tenantId = f.tenants.t1) =>
    (await ds.query(`SELECT id FROM artifact_types WHERE "tenantId" = $1 AND code = $2`, [tenantId, code]))[0].id as number;
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    // No FK to tenants, so another suite's rows would survive the fixtures'
    // tenant truncate.
    await ds.query(`TRUNCATE artifact_types, artifact_type_rules, audit_logs, team_settings RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('only Admin and Program Manager can read or change it', async () => {
    for (const u of [f.users.devA, f.users.qaB, f.users.exec, f.users.clientA]) {
      await get(u, BASE).expect(403);
      await post(u, BASE, { label: 'Nope' }).expect(403);
      await patch(u, `${BASE}/1`, { label: 'Nope' }).expect(403);
      await put(u, `${BASE}/order`, { ids: [] }).expect(403);
      await put(u, '/submission-checklist/artifact-rules/developer', { rules: [] }).expect(403);
    }
    await get(f.users.pm, BASE).expect(200);
    await get(f.users.admin, BASE).expect(200);
    expect(await ds.query(`SELECT * FROM artifact_types WHERE label = 'Nope'`)).toHaveLength(0);
  });

  it('a tenant with no rows gets the 10 defaults once, all active, no rules', async () => {
    const res = await get(f.users.pm, BASE).expect(200);
    expect(res.body.types.map((t: any) => t.code)).toEqual([
      'APK Build',
      'Build Pipeline Link',
      'Deployment Report',
      'Pull Request Link',
      'Screenshot',
      'Demo Video',
      'Technical Documentation',
      'Design file',
      'Prototype',
      'Design spec',
    ]);
    expect(res.body.types.every((t: any) => t.active && t.label === t.code)).toBe(true);
    expect(res.body.rules).toEqual([]);
    expect(res.body.roles.map((r: any) => r.value)).toEqual(['developer', 'designer', 'devops']);
    await get(f.users.admin, BASE).expect(200);
    expect((await ds.query(`SELECT count(*)::int n FROM artifact_types WHERE "tenantId" = $1`, [f.tenants.t1]))[0].n).toBe(10);
    // The other tenant is seeded separately and can't see tenant 1's rows.
    const t2 = await get(f.users.pmT2, BASE).expect(200);
    expect(t2.body.types).toHaveLength(10);
    expect(t2.body.types.map((t: any) => t.id)).not.toContain(res.body.types[0].id);
  });

  it('adds a type with a fixed code, refuses duplicates and blanks, audited', async () => {
    const res = await post(f.users.pm, BASE, { label: '  Figma   board ' }).expect(201);
    const figma = res.body.types.find((t: any) => t.code === 'Figma board');
    expect(figma).toMatchObject({ label: 'Figma board', active: true, sortOrder: 11 });
    await post(f.users.pm, BASE, { label: 'figma BOARD' }).expect(400);
    await post(f.users.pm, BASE, { label: 'screenshot' }).expect(400);
    await post(f.users.pm, BASE, { label: '   ' }).expect(400);
    await post(f.users.pm, BASE, { label: 'x'.repeat(61) }).expect(400);
    const [entry] = await audits('artifact_type_created');
    expect(entry).toMatchObject({ userEmail: f.users.pm.email, entityType: 'ArtifactType', entityId: figma.id, tenantId: f.tenants.t1 });
    expect(JSON.parse(entry.details)).toEqual({ code: 'Figma board', label: 'Figma board' });
  });

  it('renames the label only - the stored code never changes', async () => {
    const id = await typeId('Design spec');
    const res = await patch(f.users.admin, `${BASE}/${id}`, { label: 'Design specification' }).expect(200);
    expect(res.body.types.find((t: any) => t.id === id)).toMatchObject({ code: 'Design spec', label: 'Design specification' });
    await patch(f.users.admin, `${BASE}/${id}`, { label: 'prototype' }).expect(400);
    await patch(f.users.admin, `${BASE}/${id}`, { code: 'Hacked' }).expect(200);
    expect((await ds.query(`SELECT code FROM artifact_types WHERE id = $1`, [id]))[0].code).toBe('Design spec');
    const entries = await audits('artifact_type_updated');
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0].details)).toEqual({
      code: 'Design spec',
      before: { label: 'Design spec', active: true },
      after: { label: 'Design specification', active: true },
    });
  });

  it('deactivates and reactivates; refuses a type the checklist counts', async () => {
    const pr = await typeId('Pull Request Link');
    const shot = await typeId('Screenshot');
    await patch(f.users.pm, `${BASE}/${pr}`, { active: false }).expect(400);
    await patch(f.users.pm, `${BASE}/${shot}`, { active: false }).expect(400);
    const proto = await typeId('Prototype');
    let res = await patch(f.users.pm, `${BASE}/${proto}`, { active: false }).expect(200);
    expect(res.body.types.find((t: any) => t.id === proto).active).toBe(false);
    await post(f.users.pm, BASE, { label: 'Prototype' }).expect(400);
    res = await patch(f.users.pm, `${BASE}/${proto}`, { active: true }).expect(200);
    expect(res.body.types.find((t: any) => t.id === proto).active).toBe(true);
  });

  it('reorders only with the full list', async () => {
    const ids: number[] = (await get(f.users.pm, BASE).expect(200)).body.types.map((t: any) => t.id);
    await put(f.users.pm, `${BASE}/order`, { ids: ids.slice(1) }).expect(400);
    await put(f.users.pm, `${BASE}/order`, { ids: [...ids.slice(1), ids[1]] }).expect(400);
    const reversed = [...ids].reverse();
    const res = await put(f.users.pm, `${BASE}/order`, { ids: reversed }).expect(200);
    expect(res.body.types.map((t: any) => t.id)).toEqual(reversed);
    const [entry] = await audits('artifact_types_reordered');
    expect(JSON.parse(entry.details).after[0]).toBe('Figma board');
  });

  it('sets, validates and clears per-role rules, audited', async () => {
    const file = await typeId('Design file');
    const proto = await typeId('Prototype');
    const url = '/submission-checklist/artifact-rules/designer';
    const res = await put(f.users.pm, url, {
      rules: [
        { artifactTypeId: file, requirement: 'required' },
        { artifactTypeId: proto, requirement: 'optional' },
      ],
    }).expect(200);
    expect(res.body.rules).toEqual(
      expect.arrayContaining([
        { artifactTypeId: file, role: 'designer', requirement: 'required' },
        { artifactTypeId: proto, role: 'designer', requirement: 'optional' },
      ]),
    );
    expect(res.body.rules).toHaveLength(2);

    await put(f.users.pm, '/submission-checklist/artifact-rules/qa', { rules: [] }).expect(400);
    await put(f.users.pm, url, { rules: [{ artifactTypeId: file, requirement: 'mandatory' }] }).expect(400);
    await put(f.users.pm, url, { rules: [{ artifactTypeId: file, requirement: 'required' }, { artifactTypeId: file, requirement: 'optional' }] }).expect(400);
    await put(f.users.pm, url, { rules: [{ artifactTypeId: await typeId('Design file', f.tenants.t2), requirement: 'required' }] }).expect(400);
    await patch(f.users.pm, `${BASE}/${proto}`, { active: false }).expect(200);
    await put(f.users.pm, url, { rules: [{ artifactTypeId: proto, requirement: 'optional' }] }).expect(400);
    await patch(f.users.pm, `${BASE}/${proto}`, { active: true }).expect(200);
    // Failed saves left the rules alone.
    expect(await ds.query(`SELECT * FROM artifact_type_rules WHERE role = 'designer'`)).toHaveLength(2);

    const cleared = await put(f.users.admin, url, { rules: [] }).expect(200);
    expect(cleared.body.rules).toEqual([]);
    const entries = await audits('artifact_type_rules_updated');
    expect(entries).toHaveLength(2);
    expect(JSON.parse(entries[0].details)).toEqual({
      role: 'designer',
      before: [],
      // Sorted by artifact type id.
      after: [
        { id: file, code: 'Design file', requirement: 'required' },
        { id: proto, code: 'Prototype', requirement: 'optional' },
      ]
        .sort((a, b) => a.id - b.id)
        .map(({ code, requirement }) => ({ code, requirement })),
    });
    expect(JSON.parse(entries[1].details).after).toEqual([]);
    expect(entries[1].userEmail).toBe(f.users.admin.email);
  });

  it("can't touch another tenant's types", async () => {
    const t1Type = await typeId('APK Build');
    await patch(f.users.pmT2, `${BASE}/${t1Type}`, { label: 'Stolen' }).expect(404);
    expect((await ds.query(`SELECT label FROM artifact_types WHERE id = $1`, [t1Type]))[0].label).toBe('APK Build');
  });
});
