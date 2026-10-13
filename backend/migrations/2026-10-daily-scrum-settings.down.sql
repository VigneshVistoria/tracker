-- Rollback for 2026-10-daily-scrum-settings.sql. Daily Scrum falls back to
-- Africa/Addis_Ababa, 07:30-15:30 for every tenant without this table's
-- row, but the settings endpoints need the table - roll the app back
-- first, then drop it. Past settings changes stay in audit_logs.
BEGIN;
DROP TABLE "team_settings";
COMMIT;
