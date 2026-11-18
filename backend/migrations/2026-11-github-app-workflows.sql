-- Two apps in one repository, told apart by workflow name (2026-11-18,
-- approved by the user for the LMS pilot: lms-core-foundation holds
-- LMS Frontend ("Frontend CI/CD") and LMS Backend ("Backend CI/CD")).
--   github_repo_mappings."appWorkflows" ([]) - the GitHub Actions workflow
--     names that belong to this app; empty = every workflow (as before).
--   One repository may now have several mappings, one per app name
--     (unique repository + app name, any case) instead of one per repository.
--     The service requires every mapping of a shared repository to name its
--     own, non-overlapping workflows.
-- Run once (the apply script skips it if appWorkflows already exists).
-- Rollback: 2026-11-github-app-workflows.down.sql.
BEGIN;
ALTER TABLE "github_repo_mappings" ADD COLUMN "appWorkflows" jsonb NOT NULL DEFAULT '[]';
DROP INDEX "UQ_github_repo_mappings_repo";
CREATE UNIQUE INDEX "UQ_github_repo_mappings_repo_app" ON "github_repo_mappings" (lower("repoFullName"), lower("appName"));
COMMIT;
