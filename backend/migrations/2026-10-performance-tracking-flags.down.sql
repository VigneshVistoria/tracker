-- Rollback for 2026-10-performance-tracking-flags.sql. Drops the trigger,
-- its function, the task_flags table and the two task_dependency_tickets
-- columns. Flag history and needed-by dates are lost. Deploy the previous
-- code first - the current code reads these columns.
BEGIN;
DROP TRIGGER IF EXISTS "TRG_project_tasks_clear_task_flags" ON "project_tasks";
DROP FUNCTION IF EXISTS tracker_clear_task_flags();
DROP TABLE IF EXISTS "task_flags";
ALTER TABLE "task_dependency_tickets" DROP COLUMN IF EXISTS "overdueAt";
ALTER TABLE "task_dependency_tickets" DROP COLUMN IF EXISTS "needByDate";
COMMIT;
