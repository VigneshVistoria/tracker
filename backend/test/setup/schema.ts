import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TEST_DB, assertTestDatabase } from './test-db-config';

const SRC = path.resolve(__dirname, '../../src');
// Applied in order, exactly as on production.
const MIGRATIONS = ['2026-10-client-portal-foundation.sql', '2026-10-client-portal-tickets.sql', '2026-10-client-portal-attachments.sql'].map((f) =>
  path.resolve(__dirname, '../../migrations', f),
);
const PORTAL_DIR = path.join(SRC, 'client-portal');
// The team_settings table (Daily Scrum, QA summary) - created from its real
// migration, like the portal tables, and checked against its entity.
const TEAM_SETTINGS_DIR = path.join(SRC, 'team-settings');
const DAILY_SCRUM_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-daily-scrum-settings.sql');
// Daily Scrum Stage 3 (scrum_external_waits) - same: real migration,
// checked against the entity.
const EXTERNAL_WAIT_ENTITY = path.join(SRC, 'daily-scrum', 'scrum-external-wait.entity.ts');
const EXTERNAL_WAITS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-daily-scrum-external-waits.sql');
// Defect screenshots (task_attachments) - same: real migration, checked
// against the entity.
const TASK_ATTACHMENT_ENTITY = path.join(SRC, 'tasks', 'task-attachment.entity.ts');
const TASK_ATTACHMENTS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-task-attachments.sql');
// Project Timeline (project_timeline_rows/_teams) - same: real migration,
// checked against the entities.
const TIMELINE_DIR = path.join(SRC, 'project-timeline');
const TIMELINE_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-project-timeline.sql');
// Stage B dependencies - same folder, so also created by its real migration.
const TIMELINE_DEPS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-project-timeline-dependencies.sql');
const TIMELINE_TICKETS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-project-timeline-ticket-links.sql');
// Web sign-in sessions - same: real migration, checked against the entity.
const REFRESH_SESSION_ENTITY = path.join(SRC, 'auth', 'refresh-session.entity.ts');
const REFRESH_SESSIONS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-refresh-sessions.sql');
// QA decision screenshots - same: real migration, checked against the entity.
const QA_REVIEW_ATTACHMENT_ENTITY = path.join(SRC, 'tasks', 'task-qa-review-attachment.entity.ts');
const QA_REVIEW_ATTACHMENTS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-qa-review-attachments.sql');
const JUNK_COLUMNS =['statusBeforeJunk', 'junkReason', 'junkedAt', 'junkedByUserId', 'junkedByEmail'];
// Revert QA decision columns on task_qa_reviews - same treatment as the
// Junk columns: re-added by the real migration and checked against the entity.
const QA_REVERT_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-qa-decision-revert.sql');
const QA_REVERT_COLUMNS = ['revertedByUserId', 'revertedAt', 'revertReason', 'revertedDecision'];
// PM review gate columns - same: dropped from what synchronize made, re-
// added by the real migration (after team_settings exists), then checked.
const PM_REVIEW_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-pm-review-gate.sql');
const PM_REVIEW_COLUMNS: Record<string, string[]> = {
  projects: ['pmReviewEnabled'],
  project_tasks: ['pmWaitWorkingDays'],
  task_qa_reviews: ['reminderSentAt', 'adminReminderSentAt'],
};

function entityFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return entityFiles(p);
    return d.name.endsWith('.entity.ts') ? [p] : [];
  });
}

function dataSource(entities: string[]) {
  const options = { type: 'postgres' as const, ...TEST_DB, ssl: { rejectUnauthorized: false }, entities };
  assertTestDatabase(options);
  return new DataSource(options);
}

// Builds the test schema the way production got it: every existing table
// from its entity, then the client portal tables from THE REAL MIGRATION
// FILES (not from the entities), then checks the migrations match the
// portal entities column for column - so the migrations themselves are tested.
export async function buildTestSchema() {
  const all = entityFiles(SRC);
  const existing = all.filter(
    (f) => !f.startsWith(PORTAL_DIR) && !f.startsWith(TEAM_SETTINGS_DIR) && f !== TASK_ATTACHMENT_ENTITY && f !== EXTERNAL_WAIT_ENTITY && f !== REFRESH_SESSION_ENTITY && f !== QA_REVIEW_ATTACHMENT_ENTITY && !f.startsWith(TIMELINE_DIR),
  );
  const portal = all.filter((f) => f.startsWith(PORTAL_DIR));

  const base = dataSource(existing);
  await base.initialize();
  await base.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await base.synchronize();
  for (const file of MIGRATIONS) await base.query(fs.readFileSync(file, 'utf8'));
  // Junk columns on the existing project_tasks table: drop what synchronize
  // created from the entity and add them back with THE REAL MIGRATION, so
  // it is checked against the entity below like the portal tables.
  await base.query(
    `ALTER TABLE "project_tasks" ${JUNK_COLUMNS.map((c) => `DROP COLUMN "${c}"`).join(', ')}`,
  );
  await base.query(fs.readFileSync(path.resolve(__dirname, '../../migrations/2026-10-task-junk.sql'), 'utf8'));
  await base.query(`ALTER TABLE "task_qa_reviews" ${QA_REVERT_COLUMNS.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  await base.query(fs.readFileSync(QA_REVERT_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(DAILY_SCRUM_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(TASK_ATTACHMENTS_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(PM_REVIEW_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(PM_REVIEW_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(TIMELINE_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(TIMELINE_DEPS_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(TIMELINE_TICKETS_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(EXTERNAL_WAITS_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(REFRESH_SESSIONS_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(QA_REVIEW_ATTACHMENTS_MIGRATION, 'utf8'));
  await base.destroy();

  const check = dataSource(all);
  await check.initialize();
  const problems: string[] = [];
  const portalTables = ['clients', 'client_users', 'client_team_members', 'client_tickets', 'client_requests', 'client_ticket_comments', 'client_ticket_events', 'client_ticket_attachments'];
  const portalMetas = check.entityMetadatas.filter((m) => portalTables.includes(m.tableName));
  if (portalMetas.length !== portalTables.length || portal.length !== portalTables.length) {
    problems.push(`expected ${portalTables.length} portal entities, found ${portalMetas.length} (${portal.length} files)`);
  }
  const scrumMeta = check.entityMetadatas.find((m) => m.tableName === 'team_settings');
  if (!scrumMeta) problems.push('team_settings: entity missing');
  const taskAttachmentMeta = check.entityMetadatas.find((m) => m.tableName === 'task_attachments');
  if (!taskAttachmentMeta) problems.push('task_attachments: entity missing');
  const timelineMetas = check.entityMetadatas.filter((m) => ['project_timeline_rows', 'project_timeline_teams', 'project_timeline_dependencies', 'project_timeline_ticket_links'].includes(m.tableName));
  if (timelineMetas.length !== 4) problems.push('project_timeline_rows/_teams/_dependencies/_ticket_links: entity missing');
  const externalWaitMeta = check.entityMetadatas.find((m) => m.tableName === 'scrum_external_waits');
  if (!externalWaitMeta) problems.push('scrum_external_waits: entity missing');
  const refreshSessionMeta = check.entityMetadatas.find((m) => m.tableName === 'refresh_sessions');
  if (!refreshSessionMeta) problems.push('refresh_sessions: entity missing');
  const qaReviewAttachmentMeta = check.entityMetadatas.find((m) => m.tableName === 'task_qa_review_attachments');
  if (!qaReviewAttachmentMeta) problems.push('task_qa_review_attachments: entity missing');
  for (const meta of [...portalMetas, ...(scrumMeta ? [scrumMeta] : []), ...(taskAttachmentMeta ? [taskAttachmentMeta] : []), ...timelineMetas, ...(externalWaitMeta ? [externalWaitMeta] : []), ...(refreshSessionMeta ? [refreshSessionMeta] : []), ...(qaReviewAttachmentMeta ? [qaReviewAttachmentMeta] : [])]) {
    const cols: Array<{ column_name: string; is_nullable: string; data_type: string; character_maximum_length: number | null }> =
      await check.query(
        `select column_name, is_nullable, data_type, character_maximum_length from information_schema.columns
         where table_schema = 'public' and table_name = $1`,
        [meta.tableName],
      );
    if (cols.length === 0) {
      problems.push(`${meta.tableName}: table missing`);
      continue;
    }
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    for (const col of meta.columns) {
      const db = byName.get(col.databaseName);
      if (!db) {
        problems.push(`${meta.tableName}.${col.databaseName}: in entity, missing from migration`);
        continue;
      }
      byName.delete(col.databaseName);
      if ((db.is_nullable === 'YES') !== col.isNullable) {
        problems.push(`${meta.tableName}.${col.databaseName}: nullable mismatch (entity ${col.isNullable}, db ${db.is_nullable})`);
      }
      const expected = check.driver.normalizeType(col);
      const dbType = db.data_type;
      if (expected !== dbType) problems.push(`${meta.tableName}.${col.databaseName}: type mismatch (entity ${expected}, db ${dbType})`);
      if (col.length && Number(col.length) !== Number(db.character_maximum_length)) {
        problems.push(`${meta.tableName}.${col.databaseName}: length mismatch (entity ${col.length}, db ${db.character_maximum_length})`);
      }
    }
    for (const extra of byName.keys()) problems.push(`${meta.tableName}.${extra}: in migration, missing from entity`);
  }
  const taskMeta = check.entityMetadatas.find((m) => m.tableName === 'project_tasks')!;
  const taskCols: Array<{ column_name: string; is_nullable: string; data_type: string }> = await check.query(
    `select column_name, is_nullable, data_type from information_schema.columns where table_schema = 'public' and table_name = 'project_tasks'`,
  );
  for (const name of JUNK_COLUMNS) {
    const col = taskMeta.columns.find((c) => c.databaseName === name);
    const db = taskCols.find((c) => c.column_name === name);
    if (!col || !db) {
      problems.push(`project_tasks.${name}: missing from ${col ? 'migration' : 'entity'}`);
      continue;
    }
    if (db.is_nullable !== 'YES' || !col.isNullable) problems.push(`project_tasks.${name}: must be nullable in both`);
    if (check.driver.normalizeType(col) !== db.data_type) {
      problems.push(`project_tasks.${name}: type mismatch (entity ${check.driver.normalizeType(col)}, db ${db.data_type})`);
    }
  }
  const reviewMeta = check.entityMetadatas.find((m) => m.tableName === 'task_qa_reviews')!;
  const reviewCols: Array<{ column_name: string; is_nullable: string; data_type: string }> = await check.query(
    `select column_name, is_nullable, data_type from information_schema.columns where table_schema = 'public' and table_name = 'task_qa_reviews'`,
  );
  for (const [table, cols] of Object.entries(PM_REVIEW_COLUMNS)) {
    const meta = check.entityMetadatas.find((m) => m.tableName === table)!;
    const dbCols: Array<{ column_name: string; is_nullable: string; data_type: string }> = await check.query(
      `select column_name, is_nullable, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [table],
    );
    for (const name of cols) {
      const col = meta.columns.find((c) => c.databaseName === name);
      const db = dbCols.find((c) => c.column_name === name);
      if (!col || !db) {
        problems.push(`${table}.${name}: missing from ${col ? 'migration' : 'entity'}`);
        continue;
      }
      if ((db.is_nullable === 'YES') !== col.isNullable) problems.push(`${table}.${name}: nullable mismatch`);
      if (check.driver.normalizeType(col) !== db.data_type) {
        problems.push(`${table}.${name}: type mismatch (entity ${check.driver.normalizeType(col)}, db ${db.data_type})`);
      }
    }
  }
  for (const name of QA_REVERT_COLUMNS) {
    const col = reviewMeta.columns.find((c) => c.databaseName === name);
    const db = reviewCols.find((c) => c.column_name === name);
    if (!col || !db) {
      problems.push(`task_qa_reviews.${name}: missing from ${col ? 'migration' : 'entity'}`);
      continue;
    }
    if (db.is_nullable !== 'YES' || !col.isNullable) problems.push(`task_qa_reviews.${name}: must be nullable in both`);
    if (check.driver.normalizeType(col) !== db.data_type) {
      problems.push(`task_qa_reviews.${name}: type mismatch (entity ${check.driver.normalizeType(col)}, db ${db.data_type})`);
    }
  }
  await check.destroy();
  if (problems.length) throw new Error(`Migrations do not match the entities:\n  ${problems.join('\n  ')}`);
}
