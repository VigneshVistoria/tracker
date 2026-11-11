-- Own performance figures for team members (2026-11-11, the user's
-- instruction): Developers, Designers, DevOps and QA see NO performance /
-- scorecard / KPI / attendance figures - not even their own - unless an
-- Admin turns it on for their role. Admin, Program Manager and Executive
-- are unchanged. Only visibility: everything keeps being recorded. Additive.
--   performance_tracking_settings."ownMetricsRoles" ([] = nobody) - roles
--     (developer, designer, devops, qa) that may see their own figures.
-- A tenant with no settings row uses the default (nobody).
-- Run once (the apply script skips it if the column already exists).
-- Rollback: 2026-11-own-metrics-visibility.down.sql.
BEGIN;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "ownMetricsRoles" jsonb NOT NULL DEFAULT '[]';
COMMIT;
