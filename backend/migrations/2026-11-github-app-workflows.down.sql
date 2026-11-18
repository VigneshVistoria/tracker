-- Rollback for 2026-11-github-app-workflows.sql. Deploy the previous code
-- first. Fails (and changes nothing) while a repository has more than one
-- mapping - remove the extra mappings first.
BEGIN;
DROP INDEX IF EXISTS "UQ_github_repo_mappings_repo_app";
CREATE UNIQUE INDEX "UQ_github_repo_mappings_repo" ON "github_repo_mappings" (lower("repoFullName"));
ALTER TABLE "github_repo_mappings" DROP COLUMN IF EXISTS "appWorkflows";
COMMIT;
