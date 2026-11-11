-- Rollback for 2026-11-github-release-stages.sql. Drops the stage deploys,
-- task stage progress, each repository's stage list and P1 stage, the
-- delivery log's stage name and the switch (all lost). Deploy the
-- previous code first.
BEGIN;
DROP TABLE IF EXISTS "task_stage_progress";
DROP TABLE IF EXISTS "github_stage_deployments";
ALTER TABLE "github_webhook_deliveries" DROP COLUMN IF EXISTS "stageName";
ALTER TABLE "github_repo_mappings" DROP COLUMN IF EXISTS "p1StageKey";
ALTER TABLE "github_repo_mappings" DROP COLUMN IF EXISTS "stages";
ALTER TABLE "github_settings" DROP COLUMN IF EXISTS "releaseStagesEnabled";
COMMIT;
