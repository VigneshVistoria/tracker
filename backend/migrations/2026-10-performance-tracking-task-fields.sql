-- Performance Tracking, Wave 1 Stage S4b - task type, requirement ID,
-- client impact, and the PM's decision on a developer's improvement
-- (2026-10-28, decisions from the user). See backend/src/tasks/task-fields.ts.
-- Additive only: with a project's switch OFF nothing behaves differently,
-- and existing tasks stay "Not set" (no reclassification).
--   project_tasks."taskType" - 'feature' | 'improvement' | 'other' (defects
--     keep isDefect and have none). Required at creation on a tracked
--     project.
--   project_tasks."requirementId" - required before QA submission on a
--     Feature (tracked).
--   project_tasks."clientImpact" - at least 20 characters before QA
--     submission on a Feature or Improvement (tracked). Internal only -
--     never shown on the client portal.
--   project_tasks."improvementDecision" / ...DecidedByUserId / ...DecidedAt /
--     ...DeclineReason - a PM accepts or declines an Improvement a
--     developer created (O5 counts only accepted ones). Declining keeps the
--     type; the reason is required.
-- Run once (the apply script skips it if the column already exists).
-- Rollback: 2026-10-performance-tracking-task-fields.down.sql.
BEGIN;

ALTER TABLE "project_tasks" ADD COLUMN "taskType" character varying(20) NULL;
ALTER TABLE "project_tasks" ADD COLUMN "requirementId" character varying(100) NULL;
ALTER TABLE "project_tasks" ADD COLUMN "clientImpact" text NULL;
ALTER TABLE "project_tasks" ADD COLUMN "improvementDecision" character varying(10) NULL;
ALTER TABLE "project_tasks" ADD COLUMN "improvementDecidedByUserId" integer NULL;
ALTER TABLE "project_tasks" ADD COLUMN "improvementDecidedAt" TIMESTAMP NULL;
ALTER TABLE "project_tasks" ADD COLUMN "improvementDeclineReason" text NULL;
ALTER TABLE "project_tasks" ADD CONSTRAINT "CHK_project_tasks_taskType" CHECK ("taskType" IS NULL OR "taskType" IN ('feature', 'improvement', 'other'));
ALTER TABLE "project_tasks" ADD CONSTRAINT "CHK_project_tasks_improvementDecision" CHECK ("improvementDecision" IS NULL OR "improvementDecision" IN ('accepted', 'declined'));

COMMIT;
