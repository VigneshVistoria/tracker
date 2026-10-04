-- Run only after 2026-10-task-dependency-ticket-title.sql has been applied
-- AND scripts/backfill-task-dependency-ticket-titles.js --apply has
-- backfilled every existing row (this will fail with a NOT NULL violation
-- if any row is still missing a title - intentional, same safety check as
-- 2026-09-task-title-not-null.sql).
ALTER TABLE "task_dependency_tickets" ALTER COLUMN "title" SET NOT NULL;
