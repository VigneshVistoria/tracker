-- "New My work screen" setting (2026-11-17, asked for by the user): replaces
-- the DEV_MY_WORK code flag so Admin/PM can switch the developer home
-- "My work" screen on/off (plus optional pilot users) without a deploy.
-- OFF by default - Developer, Designer and DevOps keep the old dashboard.
--   team_settings."myWorkScreen" jsonb {"enabled": false, "pilotUserIds": []}
-- Additive only. Run once (the apply script skips it if the column exists).
-- Rollback: 2026-11-my-work-screen.down.sql.
BEGIN;
ALTER TABLE "team_settings" ADD COLUMN "myWorkScreen" jsonb NOT NULL DEFAULT '{"enabled": false, "pilotUserIds": []}';
COMMIT;
