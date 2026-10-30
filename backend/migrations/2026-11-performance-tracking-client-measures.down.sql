-- Rollback for 2026-11-performance-tracking-client-measures.sql. Drops the
-- tiers, UAT results and satisfaction responses (lost) and the settings.
-- Deploy the previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "clientMinSample";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "clientWindowDays";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "satisfactionQuestions";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "clientPriorityTiers";
DROP TABLE IF EXISTS "release_satisfaction";
DROP TABLE IF EXISTS "task_uat_results";
DROP TABLE IF EXISTS "task_priority_tier_events";
ALTER TABLE "project_tasks" DROP CONSTRAINT IF EXISTS "CHK_project_tasks_client_priority_tier";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "clientPriorityTier";
COMMIT;
