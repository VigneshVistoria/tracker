-- Performance metrics (2026-10-27, confirmed with the user): three NEW
-- tables only - nothing existing is changed, so the running app is
-- unaffected before and after the deploy.
--   task_commitment_events      - assignment / Due date events, one per
--                                 audit entry (TaskCommitmentEvent)
--   performance_metric_settings - editable rules and thresholds, one row
--                                 per tenant (none = the defaults)
--   performance_holidays        - holidays skipped when counting working days
-- History is filled by 2026-10-performance-metrics-backfill.sql.
-- Rollback: 2026-10-performance-metrics.down.sql.
BEGIN;
CREATE TABLE "task_commitment_events" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "kind" character varying(20) NOT NULL,
  "assigneeUserId" integer,
  "previousAssigneeUserId" integer,
  "actorUserId" integer,
  "actorRole" character varying,
  "occurredAt" TIMESTAMP NOT NULL,
  "oldDueDate" date,
  "newDueDate" date,
  "direction" character varying(10),
  "source" character varying(20) NOT NULL,
  "auditLogId" integer NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_task_commitment_events" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_task_commitment_events_auditLogId" UNIQUE ("auditLogId"),
  CONSTRAINT "CHK_task_commitment_events_kind" CHECK ("kind" IN ('assigned', 'unassigned', 'due_set', 'due_changed', 'due_cleared')),
  CONSTRAINT "CHK_task_commitment_events_source" CHECK ("source" IN ('live', 'reconstructed'))
);
CREATE INDEX "IDX_task_commitment_events_tenant_task" ON "task_commitment_events" ("tenantId", "taskId");

CREATE TABLE "performance_metric_settings" (
  "tenantId" integer NOT NULL,
  "timeZone" character varying NOT NULL DEFAULT 'Africa/Addis_Ababa',
  "dueDateWorkingDays" integer NOT NULL DEFAULT 1,
  "weekendDays" character varying(20) NOT NULL DEFAULT '0,6',
  "windowDays" integer NOT NULL DEFAULT 28,
  "minSample" integer NOT NULL DEFAULT 5,
  "onTimeOkPercent" numeric(5,2) NOT NULL DEFAULT 90,
  "changesOkPerTask" numeric(5,2) NOT NULL DEFAULT 0.5,
  "qaAcceptanceOkPercent" numeric(5,2) NOT NULL DEFAULT 75,
  "excludedStatuses" character varying NOT NULL DEFAULT 'Junk,Hold',
  "includePeerReview" boolean NOT NULL DEFAULT false,
  "countEscalatedAsDecided" boolean NOT NULL DEFAULT false,
  "alreadyDatedCountsOnTime" boolean NOT NULL DEFAULT true,
  "othersSettingDateCountsOnTime" boolean NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedByUserId" integer,
  CONSTRAINT "PK_performance_metric_settings" PRIMARY KEY ("tenantId")
);

CREATE TABLE "performance_holidays" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "date" date NOT NULL,
  "name" character varying(120) NOT NULL,
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_performance_holidays" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_performance_holidays_tenant_date" UNIQUE ("tenantId", "date")
);
COMMIT;
