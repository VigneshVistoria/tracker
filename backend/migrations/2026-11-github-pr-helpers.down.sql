-- Rollback for 2026-11-github-pr-helpers.sql. Drops the PR helper settings
-- (switch, project list, branch prefix). Deploy the previous code first.
BEGIN;
ALTER TABLE "github_settings" DROP CONSTRAINT IF EXISTS "CHK_github_settings_branch_prefix";
ALTER TABLE "github_settings" DROP COLUMN IF EXISTS "branchPrefix";
ALTER TABLE "github_settings" DROP COLUMN IF EXISTS "prHelperProjectIds";
ALTER TABLE "github_settings" DROP COLUMN IF EXISTS "prHelpersEnabled";
COMMIT;
