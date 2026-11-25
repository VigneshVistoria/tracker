import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures } from './setup/fixtures';

// Requirements traceability Stage 1 (2026-11-25): the real migration, seed
// and rollback files. The schema itself (every column vs the entities) is
// checked in test/setup/schema.ts; this checks the data and the rules the
// database enforces.
const MIGRATIONS = path.resolve(__dirname, '../migrations');
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');

describe('Requirements Stage 1 migration + seed (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  // The production seed targets project #6 and a PM named Vignesh*; in the
  // test database it targets the fixture LMS project and its PM.
  const seedSql = () => {
    const sql = read('2026-11-requirements-s1-seed.sql');
    expect(sql).toContain('v_project integer := 6; -- SEED_PROJECT');
    expect(sql).toContain(`v_reviewer_pattern text := 'Vignesh%'; -- SEED_REVIEWER`);
    // Without the file's BEGIN/COMMIT (the DO block is atomic by itself), so
    // a deliberate failure can't leave a pooled connection mid-transaction.
    return sql
      .replace(/^BEGIN;$/m, '')
      .replace(/^COMMIT;$/m, '')
      .replace('v_project integer := 6; -- SEED_PROJECT', `v_project integer := ${f.projects.pLms};`)
      .replace(`v_reviewer_pattern text := 'Vignesh%'; -- SEED_REVIEWER`, `v_reviewer_pattern text := 'Name pm';`);
  };
  const srsCount = async () => Number((await ds.query(`SELECT count(*)::int AS n FROM srs_documents`))[0].n);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    f = await seedFixtures(ds);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the switch column exists and is OFF by default', async () => {
    const [col] = await ds.query(`select column_default, is_nullable from information_schema.columns where table_name = 'team_settings' and column_name = 'requirementsTree'`);
    expect(col).toEqual({ column_default: 'false', is_nullable: 'NO' });
  });

  it('seeds exactly the Lien SRS: 40 / 6 / 23 / 65 / 41, In review, Draft, Not run, no tickets', async () => {
    await ds.query(seedSql());
    const [doc] = await ds.query(`SELECT * FROM srs_documents`);
    expect(doc).toMatchObject({
      tenantId: f.tenants.t1,
      projectId: f.projects.pLms,
      name: 'Lien, Litigation & Court Collateral',
      version: '1.0',
      status: 'in_review',
      reviewerUserIds: [f.users.pm.id],
      lineageId: null,
      deletedAt: null,
    });
    const n = async (sql: string) => Number((await ds.query(sql, [doc.id]))[0].n);
    expect(await n(`SELECT count(*) n FROM srs_requirements WHERE "srsId" = $1`)).toBe(40);
    expect(await n(`SELECT count(*) n FROM srs_epics WHERE "srsId" = $1`)).toBe(6);
    expect(await n(`SELECT count(*) n FROM srs_stories WHERE "srsId" = $1`)).toBe(23);
    expect(await n(`SELECT count(*) n FROM srs_stories WHERE "srsId" = $1 AND status <> 'draft'`)).toBe(0);
    expect(await n(`SELECT count(*) n FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s."srsId" = $1`)).toBe(65);
    expect(await n(`SELECT count(*) n FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s."srsId" = $1 AND (c.result <> 'not_run' OR c."resultByUserId" IS NOT NULL)`)).toBe(0);
    expect(await n(`SELECT count(*) n FROM srs_story_requirements l JOIN srs_stories s ON s.id = l."storyId" WHERE s."srsId" = $1`)).toBe(41);
    // Every requirement is traced by at least one story.
    expect(await n(`SELECT count(*) n FROM srs_requirements r WHERE r."srsId" = $1 AND NOT EXISTS (SELECT 1 FROM srs_story_requirements l WHERE l."requirementId" = r.id)`)).toBe(0);
    expect(Number((await ds.query(`SELECT count(*) n FROM srs_story_tickets`))[0].n)).toBe(0);
    expect(Number((await ds.query(`SELECT count(*) n FROM srs_criterion_results`))[0].n)).toBe(0);

    // Spot checks against the sample, word for word.
    const [ln10] = await ds.query(`SELECT code, prefix, seq, text, priority FROM srs_requirements WHERE code = 'LN-10'`);
    expect(ln10).toEqual({ code: 'LN-10', prefix: 'LN', seq: 10, text: 'If the customer is not the owner, a signed, verified owner consent document is mandatory', priority: 'high' });
    const [nfr4] = await ds.query(`SELECT prefix, seq, priority FROM srs_requirements WHERE code = 'NFR-4'`);
    expect(nfr4).toEqual({ prefix: 'NFR', seq: 4, priority: 'medium' });
    const [e1] = await ds.query(`SELECT name, "srsSection" FROM srs_epics WHERE code = 'E1'`);
    expect(e1).toEqual({ name: 'Formal lien', srsSection: 'SRS 4.1, 4.3, 4.4' });
    const [us02] = await ds.query(`SELECT s.title, s."asA", s."soThat", e.code AS epic FROM srs_stories s JOIN srs_epics e ON e.id = s."epicId" WHERE s.code = 'US-02'`);
    expect(us02).toEqual({ title: 'Capture relationship and owner consent', asA: 'bank officer', soThat: 'a relative or partner can use the property as security legally', epic: 'E1' });
    const us02Reqs = await ds.query(`SELECT r.code FROM srs_story_requirements l JOIN srs_requirements r ON r.id = l."requirementId" JOIN srs_stories s ON s.id = l."storyId" WHERE s.code = 'US-02' ORDER BY r.seq`);
    expect(us02Reqs.map((r: any) => r.code)).toEqual(['LN-09', 'LN-10', 'LN-11']);
    const us02Ac = await ds.query(`SELECT c.position, c.text FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s.code = 'US-02' ORDER BY c.position`);
    expect(us02Ac.map((c: any) => c.position)).toEqual([1, 2, 3, 4]);
    expect(us02Ac[1].text).toBe('If relationship is not Self, a signed consent document is mandatory');
    const [hl02] = await ds.query(`SELECT text FROM srs_requirements WHERE code = 'HL-02'`);
    expect(hl02.text).toBe('Label "Historical – Unregistered" and keep separate from formal liens');
  });

  it('running the seed again changes nothing', async () => {
    await ds.query(seedSql());
    expect(await srsCount()).toBe(1);
    expect(Number((await ds.query(`SELECT count(*) n FROM srs_requirements`))[0].n)).toBe(40);
  });

  it('refuses to seed unless exactly one PM matches the reviewer name', async () => {
    const other = await ds.query(`INSERT INTO projects ("tenantId", name) VALUES ($1, 'Other LMS') RETURNING id`, [f.tenants.t1]);
    const sql = seedSql().replace(`v_project integer := ${f.projects.pLms};`, `v_project integer := ${other[0].id};`);
    await expect(ds.query(sql.replace(`'Name pm'`, `'Nobody%'`))).rejects.toThrow(/exactly 1 Program Manager/);
    await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, 'pm2@test.local', 'x', 'Name pm', 'program_manager')`, [f.tenants.t1]);
    await expect(ds.query(sql)).rejects.toThrow(/exactly 1 Program Manager/);
    await ds.query(`DELETE FROM users WHERE email = 'pm2@test.local'`);
    await expect(ds.query(seedSql().replace(`v_project integer := ${f.projects.pLms};`, 'v_project integer := 999999;'))).rejects.toThrow(/Project 999999 not found/);
    expect(await srsCount()).toBe(1);
  });

  it('requirement IDs are unique per SRS, including soft-deleted ones', async () => {
    const [r] = await ds.query(`SELECT "tenantId", "srsId" FROM srs_requirements WHERE code = 'LN-01'`);
    await ds.query(`UPDATE srs_requirements SET "deletedAt" = now() WHERE code = 'LN-12'`);
    await expect(
      ds.query(`INSERT INTO srs_requirements ("tenantId", "srsId", code, prefix, seq, text, priority) VALUES ($1, $2, 'LN-12', 'LN', 12, 'reuse', 'high')`, [r.tenantId, r.srsId]),
    ).rejects.toThrow(/UQ_srs_requirements/);
    await ds.query(`UPDATE srs_requirements SET "deletedAt" = NULL WHERE code = 'LN-12'`);
  });

  it('a Fail needs a reason of 10+ characters, and results need who/when', async () => {
    const [c] = await ds.query(`SELECT id FROM srs_criteria ORDER BY id LIMIT 1`);
    await expect(ds.query(`UPDATE srs_criteria SET result = 'fail', "resultNote" = 'too short', "resultByUserId" = $2, "resultAt" = now() WHERE id = $1`, [c.id, f.users.qaB.id])).rejects.toThrow(
      /CHK_srs_criteria_fail_note/,
    );
    await expect(ds.query(`UPDATE srs_criteria SET result = 'pass' WHERE id = $1`, [c.id])).rejects.toThrow(/CHK_srs_criteria_result_by/);
    await expect(ds.query(`UPDATE srs_criteria SET result = 'maybe' WHERE id = $1`, [c.id])).rejects.toThrow(/CHK_srs_criteria_result/);
  });

  it('Pass/Fail history is append-only', async () => {
    const [c] = await ds.query(`SELECT c.id, c."storyId", c."tenantId" FROM srs_criteria c ORDER BY id LIMIT 1`);
    const [h] = await ds.query(
      `INSERT INTO srs_criterion_results ("tenantId", "criterionId", "storyId", result, "storyStatus", "beforeApproval", "recordedByUserId") VALUES ($1, $2, $3, 'pass', 'draft', true, $4) RETURNING id`,
      [c.tenantId, c.id, c.storyId, f.users.qaB.id],
    );
    await expect(ds.query(`UPDATE srs_criterion_results SET result = 'fail', note = 'changed afterwards' WHERE id = $1`, [h.id])).rejects.toThrow(/append-only/);
    await expect(ds.query(`DELETE FROM srs_criterion_results WHERE id = $1`, [h.id])).rejects.toThrow(/append-only/);
    await expect(
      ds.query(`INSERT INTO srs_criterion_results ("tenantId", "criterionId", "storyId", result, note, "storyStatus", "beforeApproval", "recordedByUserId") VALUES ($1, $2, $3, 'fail', 'short', 'draft', true, $4)`, [
        c.tenantId,
        c.id,
        c.storyId,
        f.users.qaB.id,
      ]),
    ).rejects.toThrow(/CHK_srs_criterion_results_fail_note/);
  });

  it('rollback removes everything, and the migration + seed apply again cleanly', async () => {
    // Stage 2 sits on top of Stage 1: roll it back first, as on production.
    await ds.query(read('2026-11-requirements-s2.down.sql'));
    await ds.query(read('2026-11-requirements-s1.down.sql'));
    const left = await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'srs\\_%'`);
    expect(left).toEqual([]);
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'team_settings' AND column_name = 'requirementsTree'`)).toEqual([]);
    expect(await ds.query(`SELECT 1 FROM pg_proc WHERE proname = 'tracker_srs_history_is_append_only'`)).toEqual([]);
    // Put the schema back for the rest of the run.
    await ds.query(read('2026-11-requirements-s1.sql'));
    await ds.query(seedSql());
    await ds.query(read('2026-11-requirements-s2.sql'));
    expect(await srsCount()).toBe(1);
  });
});
