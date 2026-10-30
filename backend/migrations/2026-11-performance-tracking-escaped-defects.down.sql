-- Rollback for 2026-11-performance-tracking-escaped-defects.sql. Drops the
-- "found in production" columns (marks are lost) and the 2 Q4 settings.
-- Deploy the previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "escapedPerTasks";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "escapeWindowDays";
DROP INDEX IF EXISTS "IDX_project_tasks_escaped";
ALTER TABLE "project_tasks" DROP CONSTRAINT IF EXISTS "CHK_project_tasks_escapedFromTaskId";
ALTER TABLE "project_tasks" DROP CONSTRAINT IF EXISTS "CHK_project_tasks_foundInProduction";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "foundInProductionAt";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "foundInProductionByUserId";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "productionReleaseDate";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "escapedFromTaskId";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "foundInProduction";
COMMIT;
