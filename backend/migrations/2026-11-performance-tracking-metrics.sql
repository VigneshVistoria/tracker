-- Performance Tracking B2 (2026-10-30, fast-track plan approved by the
-- user) - the nightly metrics snapshot. See backend/src/performance-
-- tracking/metrics/tracking-metrics.ts. Additive only.
--   performance_metric_snapshots - one row per (night, project, person,
--     metric). Only projects with tracking ON get rows. "phase" is
--     'baseline' for the first baselineDays after the project's go-live
--     date, then 'scoring'. A re-run for the same night REPLACES that
--     night's rows for the project in one transaction (unique key below),
--     so running twice never duplicates anything.
--   performance_metric_runs - one row per run (nightly or "Recalculate
--     now"), with its outcome, for the Admin screen and troubleshooting.
-- Run once (the apply script skips it if the snapshot table exists).
-- Rollback: 2026-11-performance-tracking-metrics.down.sql.
BEGIN;

CREATE TABLE "performance_metric_snapshots" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "snapshotDate" date NOT NULL,
  "projectId" integer NOT NULL,
  "userId" integer NOT NULL,
  "metric" character varying(10) NOT NULL,
  "phase" character varying(10) NOT NULL,
  "value" numeric(12,2),
  "numerator" integer,
  "denominator" integer,
  "sample" integer NOT NULL,
  "enoughData" boolean NOT NULL,
  "windowFrom" date NOT NULL,
  "details" jsonb NOT NULL DEFAULT '{}',
  "runId" integer NOT NULL,
  "computedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_performance_metric_snapshots" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_pms_phase" CHECK ("phase" IN ('baseline', 'scoring'))
);
CREATE UNIQUE INDEX "UQ_performance_metric_snapshots_key" ON "performance_metric_snapshots" ("tenantId", "snapshotDate", "projectId", "userId", "metric");
CREATE INDEX "IDX_performance_metric_snapshots_user" ON "performance_metric_snapshots" ("tenantId", "userId", "snapshotDate");

CREATE TABLE "performance_metric_runs" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "snapshotDate" date NOT NULL,
  "trigger" character varying(10) NOT NULL,
  "triggeredByUserId" integer,
  "status" character varying(10) NOT NULL,
  "projects" integer NOT NULL DEFAULT 0,
  "rowsWritten" integer NOT NULL DEFAULT 0,
  "error" text,
  "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "finishedAt" TIMESTAMP,
  CONSTRAINT "PK_performance_metric_runs" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_pmr_trigger" CHECK ("trigger" IN ('nightly', 'manual')),
  CONSTRAINT "CHK_pmr_status" CHECK ("status" IN ('running', 'done', 'failed', 'skipped'))
);
CREATE INDEX "IDX_performance_metric_runs_tenant" ON "performance_metric_runs" ("tenantId", "startedAt");

COMMIT;
