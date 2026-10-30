-- Performance Tracking P1/P2 - release path and change ticket, entered by
-- hand on the Release Log (2026-10-30, fast-track; CI/CD webhooks are
-- blocked, so nothing comes from a pipeline yet). The open rules are
-- defaults listed for the Technical Director in /home/ec2-user/perf-
-- tracking-defaults.md. See backend/src/release-logs/release-path.ts.
-- Additive only: past releases keep these empty (charged to nobody).
--   releases."releasedByUserId" - who did the release (Developer, Designer
--     or DevOps); P1/P2 are charged to them.
--   releases."stagingSignedOffOn" / "stagingSignedOffByUserId" - the
--     staging sign-off (both or neither); P1 counts it when it is on or
--     before the release date.
--   releases."changeTicketRef" - the change ticket number or link (P2).
-- Run once (the apply script skips it if the column already exists).
-- Rollback: 2026-11-performance-tracking-release-path.down.sql.
BEGIN;

ALTER TABLE "releases" ADD COLUMN "releasedByUserId" integer NULL;
ALTER TABLE "releases" ADD COLUMN "stagingSignedOffOn" date NULL;
ALTER TABLE "releases" ADD COLUMN "stagingSignedOffByUserId" integer NULL;
ALTER TABLE "releases" ADD COLUMN "changeTicketRef" character varying(200) NULL;
ALTER TABLE "releases" ADD CONSTRAINT "CHK_releases_staging_sign_off"
  CHECK (("stagingSignedOffOn" IS NULL) = ("stagingSignedOffByUserId" IS NULL));

COMMIT;
