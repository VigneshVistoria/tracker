-- ReleaseBot Phase 2: QA workflow gate.
-- Adds a QA step between Program Manager approval and completion: approving
-- an "In Review" issue now moves it to "QA Testing" instead of straight to
-- done, and QA has its own approve ("Ready for Production", the new
-- terminal state) / reject ("QA Failed") actions. "QA Failed" is kept
-- distinct from "In Progress" so a QA-flagged rework is trackable
-- separately from a normal first-pass build - the assignee moves it into
-- "In Progress" themselves (a plain self-service transition) once ready to
-- start fixing it.
--
-- "Completed" is removed from the status enum and replaced by
-- "Ready for Production" - any issue currently sitting in "Completed" is
-- migrated onto the new terminal status first so no existing data is
-- stranded on a value that no longer exists.
--
-- Also adds Issue.qaReviewedByUserId/qaReviewedByEmail/qaReviewedAt,
-- tracking QA's own sign-off separately from the Program Manager's
-- existing reviewedBy*/reviewedAt columns.
--
-- Verified by generating this from TypeORM's own schema-diff tool against
-- the same local Postgres 16 instance used for Phase 0/1 (already at the
-- Phase 1 schema state, seeded with a test row in "Completed"), then
-- re-running the diff tool afterward and confirming (a) that test row's
-- status became 'Ready for Production' and (b) zero remaining changes.

BEGIN;

-- Drop the enum constraint on "status" temporarily so "Completed" rows can
-- be migrated onto the new value before the old one is removed.
ALTER TABLE "issues" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "issues" ALTER COLUMN "status" TYPE character varying USING "status"::text;

UPDATE "issues" SET "status" = 'Ready for Production' WHERE "status" = 'Completed';

DROP TYPE "public"."issues_status_enum";
CREATE TYPE "public"."issues_status_enum" AS ENUM('Backlog', 'In Progress', 'In Review', 'QA Testing', 'QA Failed', 'Ready for Production');

ALTER TABLE "issues" ALTER COLUMN "status" TYPE "public"."issues_status_enum" USING "status"::"public"."issues_status_enum";
ALTER TABLE "issues" ALTER COLUMN "status" SET DEFAULT 'Backlog';

-- --- QA's own review record, separate from the Program Manager's ---

ALTER TABLE "issues" ADD "qaReviewedByUserId" integer;
ALTER TABLE "issues" ADD "qaReviewedByEmail" character varying;
ALTER TABLE "issues" ADD "qaReviewedAt" TIMESTAMP;

COMMIT;
