-- Rollback for 2026-10-project-timeline-dependencies.sql. Roll the app back
-- first (the dependency endpoints need the table), then drop it. Past
-- adds/removals stay in audit_logs.
BEGIN;
DROP TABLE "project_timeline_dependencies";
COMMIT;
