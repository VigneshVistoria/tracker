-- Rollback for 2026-11-performance-tracking-github-releases.sql. Deploy the
-- previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "countGithubReleases";
COMMIT;
