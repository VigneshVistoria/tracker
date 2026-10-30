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
// Performance metrics tables - same: real migration, checked against the entities.
const PERFORMANCE_DIR = path.join(SRC, 'performance-metrics');
const PERFORMANCE_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-performance-metrics.sql');
const NC_FLAG_SETTINGS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-non-compliance-flag-settings.sql');
// QA "Not ready for testing" (2026-10-27): task_qa_reviews.notReadyReason is
// dropped from what synchronize made and re-added by the real migration;
// team_settings.qaNotReadyReasons is checked with the rest of team_settings.
const QA_NOT_READY_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-qa-not-ready.sql');
const PERFORMANCE_TABLES = ['task_commitment_events', 'performance_metric_settings', 'performance_holidays'];
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

// Defect triage Stage 1 (2026-10-27): defect_triages is created by the real
// migration (its entity is left out of synchronize); the new columns on
// projects/project_tasks are dropped from what synchronize made and re-added
// by it; team_settings.defectTriageSettings is checked with the rest of
// team_settings. All checked against the entities below.
const DEFECT_TRIAGE_ENTITY = path.join(SRC, 'tasks', 'defect-triage.entity.ts');
const DEFECT_TRIAGE_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-defect-triage.sql');
const DEFECT_TRIAGE_COLUMNS: Record<string, string[]> = {
  projects: ['defectTriageEnabled'],
  project_tasks: ['severity', 'defectType', 'defectOrigin', 'foundInBuild', 'foundInEnvironment', 'triageStatus'],
};

// Submission checklist (defect triage Stage 2, 2026-10-27) - same: the new
// columns are dropped from what synchronize made and re-added by the real
// migration; team_settings.submissionChecklistSettings is checked with the
// rest of team_settings.
const SUBMISSION_CHECKLIST_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-submission-checklist.sql');
const SUBMISSION_CHECKLIST_COLUMNS: Record<string, string[]> = {
  projects: ['submissionChecklistEnabled'],
  task_qa_reviews: ['submissionChecklist'],
};

// Performance Tracking S1 (2026-10-28): both tables (and the status event
// triggers) come from the real migration - their entities are left out of
// synchronize; the project columns are dropped from what synchronize made
// and re-added by it. All checked against the entities below.
const TRACKING_DIR = path.join(SRC, 'performance-tracking');
const TRACKING_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-performance-tracking-foundation.sql');
const TRACKING_TABLES = ['task_status_events', 'performance_tracking_settings'];
const TRACKING_COLUMNS: Record<string, string[]> = {
  projects: ['performanceTrackingEnabled', 'performanceTrackingSince'],
};
// Performance Tracking S2 (2026-10-28): due_date_change_requests from the
// real migration (entity left out of synchronize); the project_tasks
// columns dropped from what synchronize made and re-added by it.
const DUE_DATE_ENTITY = path.join(SRC, 'tasks', 'due-date-change-request.entity.ts');
const DUE_DATE_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-performance-tracking-due-date-commitment.sql');
const DUE_DATE_COLUMNS: Record<string, string[]> = {
  project_tasks: ['dueDateCommittedByUserId', 'dueDateCommittedAt'],
};
// Performance Tracking S3 (2026-10-28): task_flags from the real migration
// (its folder left out of synchronize); the task_dependency_tickets columns
// dropped from what synchronize made and re-added by it.
const FLAGS_DIR = path.join(SRC, 'task-flags');
const FLAGS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-performance-tracking-flags.sql');
const FLAGS_COLUMNS: Record<string, string[]> = {
  task_dependency_tickets: ['needByDate', 'overdueAt'],
};
// Performance Tracking S4 (2026-10-28): task_reopens from the real
// migration (entity left out of synchronize); the new columns on existing
// synchronize-made tables dropped and re-added by it. team_settings and
// performance_tracking_settings already come from migrations.
const TASK_REOPEN_ENTITY = path.join(SRC, 'tasks', 'task-reopen.entity.ts');
const QA_INTAKE_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-performance-tracking-qa-intake.sql');
const QA_INTAKE_COLUMNS: Record<string, string[]> = {
  task_qa_reviews: ['testFailedReason', 'dependencyDeclaration', 'dependencyExempt'],
  project_tasks: ['reopenCount'],
};
// Performance Tracking S4b (2026-10-28): the project_tasks columns dropped
// from what synchronize made and re-added by the real migration.
const TASK_FIELDS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-10-performance-tracking-task-fields.sql');
const TASK_FIELDS_COLUMNS: Record<string, string[]> = {
  project_tasks: ['taskType', 'requirementId', 'clientImpact', 'improvementDecision', 'improvementDecidedByUserId', 'improvementDecidedAt', 'improvementDeclineReason'],
};

// Performance Tracking B1 (2026-10-30): task_chases and task_progress_notes
// from the real migration (their folder left out of synchronize), which
// also adds the decision settings to performance_tracking_settings.
const ACTIVITY_DIR = path.join(SRC, 'task-activity');
const ACTIVITY_MIGRATION = path.resolve(__dirname, '../../migrations/2026-11-performance-tracking-chase-notes.sql');
const ACTIVITY_TABLES = ['task_chases', 'task_progress_notes'];
// Performance Tracking B2 (2026-10-30): the snapshot and run tables (in
// the performance-tracking folder, already left out of synchronize).
const METRICS_MIGRATION = path.resolve(__dirname, '../../migrations/2026-11-performance-tracking-metrics.sql');
const METRICS_TABLES = ['performance_metric_snapshots', 'performance_metric_runs', 'performance_score_overrides'];
// B3: score overrides (same folder) and the overrideRoles setting.
const SCORECARD_MIGRATION = path.resolve(__dirname, '../../migrations/2026-11-performance-tracking-scorecard.sql');

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
    (f) => !f.startsWith(PORTAL_DIR) && !f.startsWith(TEAM_SETTINGS_DIR) && f !== TASK_ATTACHMENT_ENTITY && f !== EXTERNAL_WAIT_ENTITY && f !== REFRESH_SESSION_ENTITY && f !== QA_REVIEW_ATTACHMENT_ENTITY && f !== DEFECT_TRIAGE_ENTITY && f !== DUE_DATE_ENTITY && f !== TASK_REOPEN_ENTITY && !f.startsWith(FLAGS_DIR) && !f.startsWith(ACTIVITY_DIR) && !f.startsWith(TIMELINE_DIR) && !f.startsWith(PERFORMANCE_DIR) && !f.startsWith(TRACKING_DIR),
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
  await base.query(fs.readFileSync(PERFORMANCE_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(NC_FLAG_SETTINGS_MIGRATION, 'utf8'));
  await base.query(`ALTER TABLE "task_qa_reviews" DROP COLUMN "notReadyReason"`);
  await base.query(fs.readFileSync(QA_NOT_READY_MIGRATION, 'utf8'));
  // Safe to run twice, as its header says.
  await base.query(fs.readFileSync(QA_NOT_READY_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(DEFECT_TRIAGE_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(DEFECT_TRIAGE_MIGRATION, 'utf8'));
  // Safe to run twice too.
  await base.query(fs.readFileSync(DEFECT_TRIAGE_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(SUBMISSION_CHECKLIST_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(SUBMISSION_CHECKLIST_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(SUBMISSION_CHECKLIST_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(TRACKING_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(TRACKING_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(DUE_DATE_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(DUE_DATE_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(FLAGS_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(FLAGS_MIGRATION, 'utf8'));
  // Proposed Due dates (2026-10-28): the 'due_committed' event kind.
  await base.query(fs.readFileSync(path.resolve(__dirname, '../../migrations/2026-10-performance-tracking-proposed-dates.sql'), 'utf8'));
  for (const [table, cols] of Object.entries(QA_INTAKE_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(QA_INTAKE_MIGRATION, 'utf8'));
  for (const [table, cols] of Object.entries(TASK_FIELDS_COLUMNS)) {
    await base.query(`ALTER TABLE "${table}" ${cols.map((c) => `DROP COLUMN "${c}"`).join(', ')}`);
  }
  await base.query(fs.readFileSync(TASK_FIELDS_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(ACTIVITY_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(METRICS_MIGRATION, 'utf8'));
  await base.query(fs.readFileSync(SCORECARD_MIGRATION, 'utf8'));
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
  const defectTriageMeta = check.entityMetadatas.find((m) => m.tableName === 'defect_triages');
  if (!defectTriageMeta) problems.push('defect_triages: entity missing');
  const performanceMetas = check.entityMetadatas.filter((m) => PERFORMANCE_TABLES.includes(m.tableName));
  if (performanceMetas.length !== PERFORMANCE_TABLES.length) problems.push(`${PERFORMANCE_TABLES.join('/')}: entity missing`);
  const trackingMetas = check.entityMetadatas.filter((m) => TRACKING_TABLES.includes(m.tableName));
  if (trackingMetas.length !== TRACKING_TABLES.length) problems.push(`${TRACKING_TABLES.join('/')}: entity missing`);
  const dueDateMeta = check.entityMetadatas.find((m) => m.tableName === 'due_date_change_requests');
  if (!dueDateMeta) problems.push('due_date_change_requests: entity missing');
  const flagsMeta = check.entityMetadatas.find((m) => m.tableName === 'task_flags');
  if (!flagsMeta) problems.push('task_flags: entity missing');
  const reopenMeta = check.entityMetadatas.find((m) => m.tableName === 'task_reopens');
  if (!reopenMeta) problems.push('task_reopens: entity missing');
  const activityMetas = check.entityMetadatas.filter((m) => ACTIVITY_TABLES.includes(m.tableName));
  if (activityMetas.length !== ACTIVITY_TABLES.length) problems.push(`${ACTIVITY_TABLES.join('/')}: entity missing`);
  const metricsMetas = check.entityMetadatas.filter((m) => METRICS_TABLES.includes(m.tableName));
  if (metricsMetas.length !== METRICS_TABLES.length) problems.push(`${METRICS_TABLES.join('/')}: entity missing`);
  for (const meta of [...portalMetas, ...(scrumMeta ? [scrumMeta] : []), ...(taskAttachmentMeta ? [taskAttachmentMeta] : []), ...timelineMetas, ...(externalWaitMeta ? [externalWaitMeta] : []), ...(refreshSessionMeta ? [refreshSessionMeta] : []), ...(qaReviewAttachmentMeta ? [qaReviewAttachmentMeta] : []), ...(defectTriageMeta ? [defectTriageMeta] : []), ...performanceMetas, ...trackingMetas, ...(dueDateMeta ? [dueDateMeta] : []), ...(flagsMeta ? [flagsMeta] : []), ...(reopenMeta ? [reopenMeta] : []), ...activityMetas, ...metricsMetas]) {
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
  {
    const col = reviewMeta.columns.find((c) => c.databaseName === 'notReadyReason');
    const db = reviewCols.find((c) => c.column_name === 'notReadyReason');
    if (!col || !db) problems.push(`task_qa_reviews.notReadyReason: missing from ${col ? 'migration' : 'entity'}`);
    else if (db.is_nullable !== 'YES' || !col.isNullable || check.driver.normalizeType(col) !== db.data_type) {
      problems.push('task_qa_reviews.notReadyReason: entity and migration differ');
    }
  }
  for (const [table, cols] of [...Object.entries(PM_REVIEW_COLUMNS), ...Object.entries(DEFECT_TRIAGE_COLUMNS), ...Object.entries(SUBMISSION_CHECKLIST_COLUMNS), ...Object.entries(TRACKING_COLUMNS), ...Object.entries(DUE_DATE_COLUMNS), ...Object.entries(FLAGS_COLUMNS), ...Object.entries(QA_INTAKE_COLUMNS), ...Object.entries(TASK_FIELDS_COLUMNS)]) {
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
