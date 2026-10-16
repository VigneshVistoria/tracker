-- Rollback for 2026-10-project-timeline.sql. Roll the app back first (the
-- Project Timeline endpoints need these tables), then drop them. Deletes
-- every imported plan row - take a backup first if any should be kept.
BEGIN;
DROP TABLE "project_timeline_rows";
DROP TABLE "project_timeline_teams";
COMMIT;
