-- Task Status simplification: manual Status selection is removed entirely -
-- Status is now fully auto-computed by task events (create -> Development,
-- QA submit -> Feedback/Re-Feedback, QA reject -> Failed, QA approve ->
-- Pass). This replaces the old To Do / In Progress / Ready for Feedback /
-- Feedback Pass / Feedback Failed list everywhere in the Task flow.
--
-- Released - No Showstoppers / Released - With Showstoppers are left alone
-- deliberately (confirmed with the user): existing tasks already in one of
-- those statuses keep it, and their task_status_percent_config rows are
-- untouched - just dormant, since no code path can set them anymore now
-- that the manual status endpoint (PATCH /tasks/:id/status) is gone.
--
-- Also drops "Feedback Link" (feedbackLink) - removed from the Task form
-- entirely, unrelated to and never read by the % Complete calculation.

-- 1. Backfill existing project_tasks rows onto the new status names.
UPDATE "project_tasks" SET "status" = 'Development' WHERE "status" IN ('To Do', 'In Progress') OR "status" IS NULL;
UPDATE "project_tasks" SET "status" = 'Feedback' WHERE "status" = 'Ready for Feedback';
UPDATE "project_tasks" SET "status" = 'Pass' WHERE "status" = 'Feedback Pass';
UPDATE "project_tasks" SET "status" = 'Failed' WHERE "status" = 'Feedback Failed';

ALTER TABLE "project_tasks" ALTER COLUMN "status" SET DEFAULT 'Development';
ALTER TABLE "project_tasks" ALTER COLUMN "status" SET NOT NULL;

-- 2. Drop Feedback Link.
ALTER TABLE "project_tasks" DROP COLUMN "feedbackLink";

-- 3. Rename the matching task_status_percent_config rows in place, so any
-- admin-customized percent survives the rename instead of resetting to the
-- default. 'To Do' is renamed to 'Development'; the now-duplicate
-- 'In Progress' row is dropped.
UPDATE "task_status_percent_config" SET "status" = 'Development' WHERE "status" = 'To Do';
DELETE FROM "task_status_percent_config" WHERE "status" = 'In Progress';
UPDATE "task_status_percent_config" SET "status" = 'Feedback' WHERE "status" = 'Ready for Feedback';
UPDATE "task_status_percent_config" SET "status" = 'Pass' WHERE "status" = 'Feedback Pass';
UPDATE "task_status_percent_config" SET "status" = 'Failed' WHERE "status" = 'Feedback Failed';

-- 4. Seed the new 'Re-Feedback' row (resubmission after a QA rejection)
-- for every tenant that doesn't already have one.
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Re-Feedback', 50
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Re-Feedback'
);

-- 5. Seed a 'Development' row for any tenant that had neither 'To Do' nor
-- 'In Progress' configured (defensive - matches every tenant created by
-- the original 2026-09-tasks.sql seed, but cheap to guard regardless).
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Development', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Development'
);
