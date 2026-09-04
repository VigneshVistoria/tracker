-- Project-wise KPI module. Adds the two raw-data fields the gap analysis
-- found missing (ProjectTask.actualHours/completedAt,
-- TaskDependencyTicket.status/resolvedAt - the latter had no resolution
-- concept at all before this), plus the KPI weight config (mirrors
-- performance_scoring_config's singleton-row pattern) and the frozen,
-- insert-only period-score table (mirrors weekly_reports' immutability:
-- never updated after insert, config changes only affect rows generated
-- afterward).
-- Run this once against production BEFORE deploying the application code
-- that expects it.

ALTER TABLE "project_tasks" ADD COLUMN "actualHours" numeric(5,2);
ALTER TABLE "project_tasks" ADD COLUMN "completedAt" TIMESTAMP;

ALTER TABLE "task_dependency_tickets" ADD COLUMN "status" character varying NOT NULL DEFAULT 'open';
ALTER TABLE "task_dependency_tickets" ADD COLUMN "resolvedAt" TIMESTAMP;

CREATE TABLE "kpi_config" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "hoursExceedWeight" numeric(4,2) NOT NULL DEFAULT 0.15,
  "overdueWeight" numeric(4,2) NOT NULL DEFAULT 0.25,
  "targetMissWeight" numeric(4,2) NOT NULL DEFAULT 0.15,
  "qaRejectionWeight" numeric(4,2) NOT NULL DEFAULT 0.20,
  "outboundDependencyWeight" numeric(4,2) NOT NULL DEFAULT 0.15,
  "completionBonusWeight" numeric(4,2) NOT NULL DEFAULT 0.15,
  "completionBonusCap" numeric(5,2) NOT NULL DEFAULT 10,
  "excessiveRejectionThreshold" integer NOT NULL DEFAULT 2,
  "updatedByUserId" integer,
  "updatedByEmail" character varying,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);
ALTER TABLE "kpi_config"
  ADD CONSTRAINT "FK_kpi_config_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE TABLE "kpi_period_score" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "projectName" character varying NOT NULL,
  "assigneeUserId" integer NOT NULL,
  "assigneeEmail" character varying NOT NULL,
  "periodType" character varying NOT NULL,
  "periodStart" date NOT NULL,
  "periodEnd" date NOT NULL,
  "ticketsDue" integer NOT NULL,
  "ticketsCompleted" integer NOT NULL,
  "completionPercent" numeric(5,2) NOT NULL,
  "hoursExceedPercent" numeric(5,2) NOT NULL,
  "overduePercent" numeric(5,2) NOT NULL,
  "targetMissPercent" numeric(5,2) NOT NULL,
  "qaRejectionCount" integer NOT NULL,
  "excessiveRejectionFlag" boolean NOT NULL DEFAULT false,
  "outboundDependencyOverduePercent" numeric(5,2) NOT NULL,
  "inboundDependencyOverdueCount" integer NOT NULL,
  "compositeScore" numeric(5,2) NOT NULL,
  "headlineScore" numeric(5,2),
  "auditScore" numeric(5,2),
  "weightsSnapshot" text NOT NULL,
  "generatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "generatedByUserId" integer
);
ALTER TABLE "kpi_period_score"
  ADD CONSTRAINT "FK_kpi_period_score_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE INDEX "IDX_kpi_period_score_lookup" ON "kpi_period_score" ("tenantId", "projectId", "assigneeUserId", "periodType");
CREATE INDEX "IDX_kpi_period_score_period" ON "kpi_period_score" ("tenantId", "periodType", "periodStart");
