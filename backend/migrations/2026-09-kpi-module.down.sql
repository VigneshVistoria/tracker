-- Down-migration for 2026-09-kpi-module.sql. Clean additive change, fully
-- reversible: drops the two new tables and the four new columns, no data
-- transformation needed either direction.

DROP INDEX IF EXISTS "IDX_kpi_period_score_period";
DROP INDEX IF EXISTS "IDX_kpi_period_score_lookup";
DROP TABLE IF EXISTS "kpi_period_score";
DROP TABLE IF EXISTS "kpi_config";

ALTER TABLE "task_dependency_tickets" DROP COLUMN IF EXISTS "resolvedAt";
ALTER TABLE "task_dependency_tickets" DROP COLUMN IF EXISTS "status";

ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "completedAt";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "actualHours";
