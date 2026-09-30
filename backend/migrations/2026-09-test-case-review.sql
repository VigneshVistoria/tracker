-- Adds the PM review gate on test cases (TestCase.reviewStatus + the
-- submitted/reviewed tracking columns). New rows default to 'Draft';
-- every row that already exists is backfilled to 'Ready for Execution'
-- (confirmed with the user 2026-09-30) so QA can keep running the
-- current catalog without re-approving it.
BEGIN;
CREATE TYPE "public"."test_cases_reviewstatus_enum" AS ENUM('Draft', 'Pending Review', 'Ready for Execution', 'Rejected');
ALTER TABLE "test_cases" ADD COLUMN "reviewStatus" "public"."test_cases_reviewstatus_enum" NOT NULL DEFAULT 'Draft';
UPDATE "test_cases" SET "reviewStatus" = 'Ready for Execution';
ALTER TABLE "test_cases" ADD COLUMN "submittedForReviewByUserId" integer;
ALTER TABLE "test_cases" ADD COLUMN "submittedForReviewByEmail" character varying;
ALTER TABLE "test_cases" ADD COLUMN "submittedForReviewAt" TIMESTAMP;
ALTER TABLE "test_cases" ADD COLUMN "reviewComment" text;
ALTER TABLE "test_cases" ADD COLUMN "reviewedByEmail" character varying;
ALTER TABLE "test_cases" ADD COLUMN "reviewedAt" TIMESTAMP;
COMMIT;
