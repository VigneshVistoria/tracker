import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Fixtures, FixtureUser } from './fixtures';

// Requirements traceability test data: the REAL Stage 1 + Stage 2 seed
// files, aimed at the fixture LMS project and its PM ("Name pm"), plus
// helpers for users and tickets.
const MIGRATIONS = path.resolve(__dirname, '../../migrations');
const noTx = (sql: string) => sql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

export async function seedRequirements(ds: DataSource, f: Fixtures, { clientItems = true } = {}) {
  const s1 = noTx(fs.readFileSync(path.join(MIGRATIONS, '2026-11-requirements-s1-seed.sql'), 'utf8'))
    .replace('v_project integer := 6; -- SEED_PROJECT', `v_project integer := ${f.projects.pLms};`)
    .replace(`v_reviewer_pattern text := 'Vignesh%'; -- SEED_REVIEWER`, `v_reviewer_pattern text := 'Name pm';`);
  await ds.query(s1);
  if (clientItems) {
    const s2 = noTx(fs.readFileSync(path.join(MIGRATIONS, '2026-11-requirements-s2-seed.sql'), 'utf8')).replace(
      'v_project integer := 6; -- SEED_PROJECT',
      `v_project integer := ${f.projects.pLms};`,
    );
    await ds.query(s2);
  }
  return (await ds.query(`SELECT id FROM srs_documents WHERE "projectId" = $1`, [f.projects.pLms]))[0].id as number;
}

export async function addUser(ds: DataSource, f: Fixtures, key: string, role: string, projects: number[]): Promise<FixtureUser> {
  const email = `${key}@test.local`;
  const [u] = await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, $2, 'x', $3, $4) RETURNING id`, [f.tenants.t1, email, `Name ${key}`, role]);
  for (const p of projects) await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [u.id, p]);
  return { id: u.id, email, tenantId: f.tenants.t1, role };
}

// A ticket in a project (module + phase created as needed).
export async function addTask(ds: DataSource, f: Fixtures, projectId: number, title: string, extra: { status?: string; requirementId?: string | null; assignee?: FixtureUser } = {}) {
  let [m] = await ds.query(`SELECT id, name FROM modules WHERE "projectId" = $1 ORDER BY id LIMIT 1`, [projectId]);
  if (!m) [m] = await ds.query(`INSERT INTO modules ("tenantId", "projectId", name, "isActive") VALUES ($1, $2, 'M', true) RETURNING id, name`, [f.tenants.t1, projectId]);
  let [ph] = await ds.query(`SELECT id FROM phases WHERE "moduleId" = $1 ORDER BY id LIMIT 1`, [m.id]);
  if (!ph) [ph] = await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", name) VALUES ($1, $2, 'P', $3, $4, 'Build') RETURNING id`, [f.tenants.t1, projectId, m.id, m.name]);
  const a = extra.assignee ?? f.users.devA;
  const [t] = await ds.query(
    `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "requirementId")
     VALUES ($1, $2, 'P', $3, $4, $5, 'Build', $6, 'x', $7, $8, $9, $10, $11, $12) RETURNING id`,
    [f.tenants.t1, projectId, m.id, m.name, ph.id, title, extra.status ?? 'Development', a.id, a.email, f.users.pm.id, f.users.pm.email, extra.requirementId ?? null],
  );
  return t.id as number;
}

export const storyIn = (tree: any, code: string) => tree.epics.flatMap((e: any) => e.stories).find((s: any) => s.code === code);
