-- PM/Admin can force any task to 'Hold' or 'Closed' from any current
-- status via the new PATCH /tasks/:id/hold|release|close endpoints
-- (TasksService), no reason/comment required - the one deliberate
-- exception to "status is fully auto-computed" (see task-status-percent.
-- entity.ts's TASK_STATUSES comment). Confirmed with the user 2026-09.

-- 1. priorStatus - only set while a task is on Hold, so releaseTask() can
-- resume it exactly where it left off instead of resetting to a fixed
-- status.
ALTER TABLE "project_tasks" ADD COLUMN "priorStatus" varchar;

-- 2. Seed a task_status_percent_config row for 'Hold' and 'Closed' for
-- every tenant that doesn't already have one - same seeding pattern as
-- 'Re-Feedback' in 2026-09-task-status-simplify.sql. Both default to 0%;
-- admin-editable afterward via /task-status-config like any other status.
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Hold', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Hold'
);

INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Closed', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Closed'
);
