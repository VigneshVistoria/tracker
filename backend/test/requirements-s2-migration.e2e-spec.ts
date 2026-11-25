import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures } from './setup/fixtures';

// Requirements traceability Stage 2 (2026-11-25): the real migration, seed
// and rollback files. Columns vs entities are checked in test/setup/schema.ts.
const MIGRATIONS = path.resolve(__dirname, '../migrations');
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const noTx = (sql: string) => sql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

describe('Requirements Stage 2 migration + seed (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let srsId: number;
  const seed1 = () =>
    noTx(read('2026-11-requirements-s1-seed.sql'))
      .replace('v_project integer := 6; -- SEED_PROJECT', `v_project integer := ${f.projects.pLms};`)
      .replace(`v_reviewer_pattern text := 'Vignesh%'; -- SEED_REVIEWER`, `v_reviewer_pattern text := 'Name pm';`);
  const seed2 = () => {
    const sql = read('2026-11-requirements-s2-seed.sql');
    expect(sql).toContain('v_project integer := 6; -- SEED_PROJECT');
    return noTx(sql).replace('v_project integer := 6; -- SEED_PROJECT', `v_project integer := ${f.projects.pLms};`);
  };
  const n = async (sql: string, params: any[] = []) => Number((await ds.query(sql, params))[0].n);
  const roleCounts = () => ds.query(`SELECT role::text AS role, count(*)::int AS n FROM users GROUP BY 1 ORDER BY 1`);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    f = await seedFixtures(ds);
    await ds.query(seed1());
    srsId = (await ds.query(`SELECT id FROM srs_documents`))[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("adds the 'ba' role value without changing any user", async () => {
    expect(await n(`SELECT count(*) n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'users_role_enum' AND e.enumlabel = 'ba'`)).toBe(1);
    expect(await n(`SELECT count(*) n FROM users WHERE role::text = 'ba'`)).toBe(0);
    // Running the migration's enum line again is harmless.
    await ds.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'ba'`);
  });

  it('seeds the 5 open client items word for word, linked to 7 stories; running it again changes nothing', async () => {
    const before = await roleCounts();
    await ds.query(seed2());
    await ds.query(seed2());
    const items = await ds.query(
      `SELECT i.number, i.status, i.question, i.baseline, i.owner, i."tenantId", array_agg(s.code ORDER BY s.code) AS stories
         FROM srs_client_items i JOIN srs_client_item_stories l ON l."itemId" = i.id JOIN srs_stories s ON s.id = l."storyId"
        WHERE i."srsId" = $1 GROUP BY i.id ORDER BY i.number`,
      [srsId],
    );
    expect(items.map((i: any) => [i.number, i.status, i.stories])).toEqual([
      [1, 'open', ['US-23']],
      [2, 'open', ['US-02']],
      [3, 'open', ['US-08']],
      [4, 'open', ['US-01', 'US-11', 'US-13']],
      [5, 'open', ['US-10']],
    ]);
    expect(items[1]).toMatchObject({
      question: "Legal position on a relative or third party using the owner's property, with consent",
      baseline: 'Supported, consent from every owner (LN-09 to LN-11)',
      owner: 'Client / Legal',
      tenantId: f.tenants.t1,
    });
    expect(await roleCounts()).toEqual(before);
    // Nothing else changed: still In review, all Draft, nothing at risk.
    expect((await ds.query(`SELECT status, "clientName" FROM srs_documents WHERE id = $1`, [srsId]))[0]).toEqual({ status: 'in_review', clientName: null });
    expect(await n(`SELECT count(*) n FROM srs_stories WHERE status <> 'draft' OR "atRisk"`)).toBe(0);
  });

  it('the seed refuses when the SRS is missing', async () => {
    await expect(ds.query(seed2().replace(`v_project integer := ${f.projects.pLms};`, 'v_project integer := 999999;'))).rejects.toThrow(/Lien SRS v1.0 not found/);
  });

  it('client sign-off needs every client field', async () => {
    await expect(ds.query(`UPDATE srs_documents SET status = 'client_signed_off', "clientName" = 'Bank' WHERE id = $1`, [srsId])).rejects.toThrow(/CHK_srs_documents_client_signoff/);
    await ds.query(
      `UPDATE srs_documents SET status = 'client_signed_off', "clientName" = 'Client', "clientSignedOn" = '2026-11-20', "clientFileKey" = 'k', "clientFileName" = 'signed.pdf',
         "clientFileMime" = 'application/pdf', "clientFileSize" = 10, "clientSignedByUserId" = $2, "clientSignedAt" = now() WHERE id = $1`,
      [srsId, f.users.pm.id],
    );
    await ds.query(
      `UPDATE srs_documents SET status = 'in_review', "clientName" = NULL, "clientSignedOn" = NULL, "clientFileKey" = NULL, "clientFileName" = NULL, "clientFileMime" = NULL, "clientFileSize" = NULL, "clientSignedByUserId" = NULL, "clientSignedAt" = NULL WHERE id = $1`,
      [srsId],
    );
  });

  it('Approve at risk needs a reason of 10+ characters and who/when', async () => {
    await expect(ds.query(`UPDATE srs_stories SET "atRisk" = true, "atRiskReason" = 'short', "atRiskByUserId" = $1, "atRiskAt" = now() WHERE code = 'US-04'`, [f.users.pm.id])).rejects.toThrow(
      /CHK_srs_stories_at_risk/,
    );
    await expect(ds.query(`UPDATE srs_stories SET "atRisk" = true, "atRiskReason" = 'Client sign-off expected next week' WHERE code = 'US-04'`)).rejects.toThrow(/CHK_srs_stories_at_risk/);
  });

  it('client items: numbers never reused, closing needs a resolution of 10+ characters', async () => {
    await expect(ds.query(`INSERT INTO srs_client_items ("tenantId", "srsId", number, question) VALUES ($1, $2, 3, 'again')`, [f.tenants.t1, srsId])).rejects.toThrow(/UQ_srs_client_items_number/);
    await expect(ds.query(`UPDATE srs_client_items SET status = 'closed', resolution = 'ok', "closedByUserId" = $2, "closedAt" = now() WHERE "srsId" = $1 AND number = 5`, [srsId, f.users.pm.id])).rejects.toThrow(
      /CHK_srs_client_items_closed/,
    );
    await expect(ds.query(`UPDATE srs_client_items SET status = 'maybe' WHERE "srsId" = $1 AND number = 5`, [srsId])).rejects.toThrow(/CHK_srs_client_items_(status|closed)/);
  });

  it('removing a ticket link removes the criteria it covered, never the criteria themselves', async () => {
    const [m] = await ds.query(`SELECT id FROM modules WHERE "projectId" = $1 LIMIT 1`, [f.projects.pLms]);
    const [ph] = await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", name) VALUES ($1, $2, 'LMS', $3, 'LMS Module', 'Build') RETURNING id`, [
      f.tenants.t1,
      f.projects.pLms,
      m.id,
    ]);
    const [task] = await ds.query(
      `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "createdByUserId", "createdByEmail")
       VALUES ($1, $2, 'LMS', $3, 'LMS Module', $4, 'Build', 'T', 'x', 'Backlog', $5, $6) RETURNING id`,
      [f.tenants.t1, f.projects.pLms, m.id, ph.id, f.users.pm.id, f.users.pm.email],
    );
    const [story] = await ds.query(`SELECT id FROM srs_stories WHERE code = 'US-03'`);
    const [link] = await ds.query(`INSERT INTO srs_story_tickets ("tenantId", "storyId", "taskId", kind, "linkedByUserId") VALUES ($1, $2, $3, 'dev', $4) RETURNING id`, [
      f.tenants.t1,
      story.id,
      task.id,
      f.users.pm.id,
    ]);
    await ds.query(`INSERT INTO srs_ticket_criteria ("storyTicketId", "criterionId") SELECT $1, id FROM srs_criteria WHERE "storyId" = $2`, [link.id, story.id]);
    expect(await n(`SELECT count(*) n FROM srs_ticket_criteria`)).toBe(3);
    await ds.query(`DELETE FROM srs_story_tickets WHERE id = $1`, [link.id]);
    expect(await n(`SELECT count(*) n FROM srs_ticket_criteria`)).toBe(0);
    expect(await n(`SELECT count(*) n FROM srs_criteria WHERE "storyId" = $1`, [story.id])).toBe(3);
  });

  it('rollback refuses while anyone holds BA, then removes Stage 2 cleanly; it applies again', async () => {
    const [ba] = await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, 'ba@test.local', 'x', 'Name ba', 'ba') RETURNING id`, [f.tenants.t1]);
    await expect(ds.query(noTx(read('2026-11-requirements-s2.down.sql')))).rejects.toThrow(/BA role/);
    await ds.query(`DELETE FROM users WHERE id = $1`, [ba.id]);
    await ds.query(read('2026-11-requirements-s2.down.sql'));
    for (const t of ['srs_client_items', 'srs_client_item_stories', 'srs_ticket_criteria']) {
      expect(await n(`SELECT count(*) n FROM information_schema.tables WHERE table_name = $1`, [t])).toBe(0);
    }
    expect(await n(`SELECT count(*) n FROM information_schema.columns WHERE table_name = 'srs_documents' AND column_name LIKE 'client%'`)).toBe(0);
    expect(await n(`SELECT count(*) n FROM information_schema.columns WHERE table_name = 'srs_stories' AND column_name IN ('atRisk', 'atRiskReason', 'deletedByUserId')`)).toBe(0);
    // Stage 1 data is untouched.
    expect(await n(`SELECT count(*) n FROM srs_stories`)).toBe(23);
    // Put Stage 2 back for the rest of the run.
    await ds.query(read('2026-11-requirements-s2.sql'));
    await ds.query(seed2());
    expect(await n(`SELECT count(*) n FROM srs_client_items`)).toBe(5);
  });
});
