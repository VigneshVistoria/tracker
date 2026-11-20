-- GitHub pilot rule (2026-11-20): setting "Count GitHub releases in scores",
-- default OFF. While off, P1/P2, Q4 and L5 leave out releases GitHub
-- created, release tasks GitHub added and a "released by" GitHub filled.
-- Rollback: 2026-11-performance-tracking-github-releases.down.sql.
BEGIN;
ALTER TABLE "performance_tracking_settings" ADD COLUMN IF NOT EXISTS "countGithubReleases" boolean NOT NULL DEFAULT false;
COMMIT;
