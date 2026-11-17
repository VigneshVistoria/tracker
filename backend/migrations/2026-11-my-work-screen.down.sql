-- Rollback for 2026-11-my-work-screen.sql. Drops the "New My work screen"
-- setting. Deploy the previous code first.
BEGIN;
ALTER TABLE "team_settings" DROP COLUMN IF EXISTS "myWorkScreen";
COMMIT;
