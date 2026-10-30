-- Performance Tracking P1/P2 settings (2026-10-30, user's change): P1 and
-- P2 are measured over their own window of release dates (default 90
-- days, never before go-live) and need a minimum number of releases
-- before a score (default 3; below it "Not enough data"). Both editable on
-- Performance Tracking Settings. Additive only.
-- Run once (the apply script skips it if the column already exists).
-- Rollback: 2026-11-performance-tracking-release-settings.down.sql.
BEGIN;

ALTER TABLE "performance_tracking_settings" ADD COLUMN "releaseWindowDays" integer NOT NULL DEFAULT 90;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "releaseMinSample" integer NOT NULL DEFAULT 3;

COMMIT;
