-- Run only after 2026-09-task-title.sql has been applied AND
-- scripts/backfill-task-titles.ts has backfilled every existing row (this
-- will fail with a NOT NULL violation if any row is still missing a
-- title - that's intentional, it's the safety check that the backfill
-- actually ran to completion first).
ALTER TABLE "project_tasks" ALTER COLUMN "title" SET NOT NULL;
