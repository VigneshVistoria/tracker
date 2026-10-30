-- Performance Tracking B1 (2026-10-30, fast-track plan approved by the
-- user) - Chase button (O3), assignee progress note (C5), and every open
-- decision as an editable setting with a default. See backend/src/
-- task-activity/task-activity.ts. Additive only: with a project's switch
-- OFF nothing behaves differently.
--   task_chases - one row per Chase, kept forever. "assigneeUserId" is who
--     was chased (the task's assignee at that moment); O3 counts these.
--   task_progress_notes - one row per progress note by the assignee
--     (only the assignee can write one); C5 counts these with status changes.
--   performance_tracking_settings - the decision settings (defaults are the
--     values the Technical Director is asked to review). A tenant with no
--     row keeps using the code defaults, as before.
-- Run once (the apply script skips it if task_chases already exists).
-- Rollback: 2026-11-performance-tracking-chase-notes.down.sql.
BEGIN;

CREATE TABLE "task_chases" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "assigneeUserId" integer NOT NULL,
  "chasedByUserId" integer NOT NULL,
  "note" text,
  "taskStatus" character varying(60) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_task_chases" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_task_chases_not_self" CHECK ("assigneeUserId" <> "chasedByUserId")
);
CREATE INDEX "IDX_task_chases_tenant_task" ON "task_chases" ("tenantId", "taskId");
CREATE INDEX "IDX_task_chases_tenant_assignee" ON "task_chases" ("tenantId", "assigneeUserId", "createdAt");

CREATE TABLE "task_progress_notes" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "authorUserId" integer NOT NULL,
  "body" text NOT NULL,
  "taskStatus" character varying(60) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_task_progress_notes" PRIMARY KEY ("id")
);
CREATE INDEX "IDX_task_progress_notes_tenant_task" ON "task_progress_notes" ("tenantId", "taskId");
CREATE INDEX "IDX_task_progress_notes_tenant_author" ON "task_progress_notes" ("tenantId", "authorUserId", "createdAt");

ALTER TABLE "performance_tracking_settings" ADD COLUMN "blockerLagClockStart" character varying(40) NOT NULL DEFAULT 'dependency_overdue_or_blocker';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "percentBands" jsonb NOT NULL DEFAULT '[95, 85, 70, 50]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "breachBands" jsonb NOT NULL DEFAULT '[0, 1, 2, 3]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "nonComplianceDisplay" character varying(20) NOT NULL DEFAULT 'side_by_side';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "requestSources" jsonb NOT NULL DEFAULT '["owned_dependency", "marked_request"]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "chaseRoles" jsonb NOT NULL DEFAULT '["admin", "program_manager", "executive", "qa", "developer"]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "chaseCooldownHours" integer NOT NULL DEFAULT 24;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "progressNoteMin" integer NOT NULL DEFAULT 20;
ALTER TABLE "performance_tracking_settings" ADD CONSTRAINT "CHK_pts_blocker_lag_clock" CHECK ("blockerLagClockStart" IN ('dependency_overdue_or_blocker', 'blocker_flag', 'dependency_created'));
ALTER TABLE "performance_tracking_settings" ADD CONSTRAINT "CHK_pts_non_compliance_display" CHECK ("nonComplianceDisplay" IN ('side_by_side', 'scorecard_only'));

COMMIT;
