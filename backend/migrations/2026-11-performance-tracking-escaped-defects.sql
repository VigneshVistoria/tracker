-- Performance Tracking Q4 - escaped defects (2026-10-30, fast-track; the
-- open rules are settings with defaults, listed for the Technical
-- Director in /home/ec2-user/perf-tracking-defaults.md). See
-- backend/src/tasks/escaped-defect.ts. Additive only: no existing defect
-- changes, nothing is marked "found in production" by this script.
--   project_tasks."foundInProduction" - a defect found in production.
--   project_tasks."escapedFromTaskId" - the released task it escaped from
--     (optional; with none the defect is listed but charged to nobody).
--   project_tasks."productionReleaseDate" - when that work went live
--     (required when marked; prefilled from the Release Log).
--   project_tasks."foundInProductionByUserId" / ...At - who marked it.
--   performance_tracking_settings."escapeWindowDays" (30) and
--     "escapedPerTasks" (10): Q4 counts defects found within 30 days of
--     the release, per 10 tasks released.
-- Run once (the apply script skips it if the column already exists).
-- Rollback: 2026-11-performance-tracking-escaped-defects.down.sql.
BEGIN;

ALTER TABLE "project_tasks" ADD COLUMN "foundInProduction" boolean NOT NULL DEFAULT false;
ALTER TABLE "project_tasks" ADD COLUMN "escapedFromTaskId" integer NULL;
ALTER TABLE "project_tasks" ADD COLUMN "productionReleaseDate" date NULL;
ALTER TABLE "project_tasks" ADD COLUMN "foundInProductionByUserId" integer NULL;
ALTER TABLE "project_tasks" ADD COLUMN "foundInProductionAt" TIMESTAMP NULL;
ALTER TABLE "project_tasks" ADD CONSTRAINT "CHK_project_tasks_foundInProduction"
  CHECK (NOT "foundInProduction" OR ("isDefect" AND "productionReleaseDate" IS NOT NULL));
ALTER TABLE "project_tasks" ADD CONSTRAINT "CHK_project_tasks_escapedFromTaskId"
  CHECK ("escapedFromTaskId" IS NULL OR ("foundInProduction" AND "escapedFromTaskId" <> "id"));
CREATE INDEX "IDX_project_tasks_escaped" ON "project_tasks" ("tenantId", "escapedFromTaskId") WHERE "foundInProduction";

ALTER TABLE "performance_tracking_settings" ADD COLUMN "escapeWindowDays" integer NOT NULL DEFAULT 30;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "escapedPerTasks" integer NOT NULL DEFAULT 10;

COMMIT;
