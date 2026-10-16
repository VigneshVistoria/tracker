-- Rollback for 2026-10-daily-scrum-external-waits.sql. Roll the app back
-- first (the external-waits endpoints need the table), then drop it. Past
-- adds/changes stay in audit_logs.
BEGIN;
DROP TABLE "scrum_external_waits";
COMMIT;
