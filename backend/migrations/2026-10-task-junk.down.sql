-- Rollback for 2026-10-task-junk.sql. Tickets stay in status 'Junk'; only
-- the who/when/why/previous-status details are dropped (still in audit_logs).
BEGIN;
ALTER TABLE "project_tasks"
  DROP COLUMN "statusBeforeJunk",
  DROP COLUMN "junkReason",
  DROP COLUMN "junkedAt",
  DROP COLUMN "junkedByUserId",
  DROP COLUMN "junkedByEmail";
COMMIT;
