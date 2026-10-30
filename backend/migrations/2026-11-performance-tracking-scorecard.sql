-- Performance Tracking B3 (2026-10-30, fast-track plan approved by the
-- user) - scoring overrides and who may make them. See backend/src/
-- performance-tracking/scorecard/scoring.ts. Additive only.
--   performance_score_overrides - a Technical Director override of one
--     person's score on one metric, from a night on, until removed. The
--     computed score at that moment is kept ("originalScore"), the reason
--     is required, and removing one needs a reason too. Rows are never
--     deleted; every change is also in audit_logs.
--   performance_tracking_settings."overrideRoles" - who may override
--     (default Admin; there is no Technical Director role in the tracker).
-- Run once (the apply script skips it if the table already exists).
-- Rollback: 2026-11-performance-tracking-scorecard.down.sql.
BEGIN;

CREATE TABLE "performance_score_overrides" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "metric" character varying(10) NOT NULL,
  "effectiveFrom" date NOT NULL,
  "originalScore" integer,
  "overrideScore" integer NOT NULL,
  "reason" text NOT NULL,
  "createdByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "removedByUserId" integer,
  "removedAt" TIMESTAMP,
  "removeReason" text,
  CONSTRAINT "PK_performance_score_overrides" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_pso_score" CHECK ("overrideScore" BETWEEN 1 AND 5 AND ("originalScore" IS NULL OR "originalScore" BETWEEN 1 AND 5))
);
-- At most one active override per person and metric.
CREATE UNIQUE INDEX "UQ_performance_score_overrides_active" ON "performance_score_overrides" ("tenantId", "userId", "metric") WHERE "removedAt" IS NULL;

ALTER TABLE "performance_tracking_settings" ADD COLUMN "overrideRoles" jsonb NOT NULL DEFAULT '["admin"]';

COMMIT;
