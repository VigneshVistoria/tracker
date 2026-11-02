-- Rollback for 2026-11-github-releases.sql. Drops the GitHub settings,
-- repository mappings, delivery log and staging deployments (lost), and the
-- GitHub columns on releases and users. Releases GitHub created stay, as
-- plain Release Log entries. Deploy the previous code first.
BEGIN;
DROP INDEX IF EXISTS "UQ_users_github_login";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_github_login";
ALTER TABLE "users" DROP COLUMN IF EXISTS "githubLogin";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubNotes";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubFilled";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubStagingDeployedOn";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubReleasedByLogin";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubDeliveryId";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubSha";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "githubRepo";
ALTER TABLE "releases" DROP CONSTRAINT IF EXISTS "CHK_releases_source";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "source";
DROP TABLE IF EXISTS "github_staging_deployments";
DROP TABLE IF EXISTS "github_webhook_deliveries";
DROP TABLE IF EXISTS "github_repo_mappings";
DROP TABLE IF EXISTS "github_settings";
COMMIT;
