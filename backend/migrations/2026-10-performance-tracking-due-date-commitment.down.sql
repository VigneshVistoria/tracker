-- Rollback for 2026-10-performance-tracking-due-date-commitment.sql. Drops
-- the trigger, its function, the change request table and the two
-- project_tasks columns. Due dates themselves are untouched (approved
-- changes stay applied); the request history is lost. Deploy the previous
-- code first - the current code reads these columns.
BEGIN;
DROP TRIGGER IF EXISTS "TRG_project_tasks_cancel_due_date_requests" ON "project_tasks";
DROP FUNCTION IF EXISTS tracker_cancel_due_date_requests();
DROP TABLE IF EXISTS "due_date_change_requests";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "dueDateCommittedAt";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "dueDateCommittedByUserId";
COMMIT;
