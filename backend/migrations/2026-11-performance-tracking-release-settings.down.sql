-- Rollback for 2026-11-performance-tracking-release-settings.sql. Deploy
-- the previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "releaseMinSample";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "releaseWindowDays";
COMMIT;
