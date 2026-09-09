-- Down-migration for 2026-09-kpi-qa-rejection-scaling.sql. Clean
-- additive change, fully reversible.

ALTER TABLE "kpi_config" DROP COLUMN IF EXISTS "qaRejectionPointsPerExcess";
