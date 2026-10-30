-- Rollback for 2026-11-performance-tracking-release-path.sql. Drops the
-- release path fields (lost). Deploy the previous code first.
BEGIN;
ALTER TABLE "releases" DROP CONSTRAINT IF EXISTS "CHK_releases_staging_sign_off";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "changeTicketRef";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "stagingSignedOffByUserId";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "stagingSignedOffOn";
ALTER TABLE "releases" DROP COLUMN IF EXISTS "releasedByUserId";
COMMIT;
