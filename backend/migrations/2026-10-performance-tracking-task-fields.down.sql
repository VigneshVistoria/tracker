-- Rollback for 2026-10-performance-tracking-task-fields.sql. Drops the
-- task type, requirement ID, client impact and improvement decision
-- columns (their values are lost). Deploy the previous code first.
BEGIN;
ALTER TABLE "project_tasks" DROP CONSTRAINT IF EXISTS "CHK_project_tasks_improvementDecision";
ALTER TABLE "project_tasks" DROP CONSTRAINT IF EXISTS "CHK_project_tasks_taskType";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "improvementDeclineReason";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "improvementDecidedAt";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "improvementDecidedByUserId";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "improvementDecision";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "clientImpact";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "requirementId";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "taskType";
COMMIT;
