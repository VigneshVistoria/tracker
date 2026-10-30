-- Performance Tracking C4 - handover (2026-10-30, fast-track; the open
-- rules are settings with defaults, listed for the Technical Director in
-- /home/ec2-user/perf-tracking-defaults.md). See
-- backend/src/task-handovers/task-handovers.ts. Additive only.
--   task_handovers - a task handed from its assignee to the next owner
--     with the template (what was done, how to test, known issues,
--     dependencies, environment); pending until the next owner accepts
--     (task reassigned) or rejects (reason), or the giver cancels.
--   performance_tracking_settings."handoverFieldMin" (10 characters).
-- Run once (the apply script skips it if task_handovers already exists).
-- Rollback: 2026-11-performance-tracking-handovers.down.sql.
BEGIN;

CREATE TABLE "task_handovers" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "fromUserId" integer NOT NULL,
  "startedByUserId" integer NOT NULL,
  "toUserId" integer NOT NULL,
  "whatDone" text NOT NULL,
  "howToTest" text NOT NULL,
  "knownIssues" text NOT NULL,
  "dependencies" text NOT NULL,
  "environment" text NOT NULL,
  "status" character varying(10) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "decidedAt" TIMESTAMP NULL,
  "decidedByUserId" integer NULL,
  "rejectReason" text NULL,
  CONSTRAINT "PK_task_handovers" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_task_handovers_status" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT "CHK_task_handovers_other_person" CHECK ("fromUserId" <> "toUserId"),
  CONSTRAINT "CHK_task_handovers_reject_reason" CHECK ("status" <> 'rejected' OR "rejectReason" IS NOT NULL)
);
-- At most one pending handover per task.
CREATE UNIQUE INDEX "UQ_task_handovers_pending" ON "task_handovers" ("taskId") WHERE "status" = 'pending';
CREATE INDEX "IDX_task_handovers_task" ON "task_handovers" ("tenantId", "taskId");
CREATE INDEX "IDX_task_handovers_project" ON "task_handovers" ("tenantId", "projectId", "decidedAt");

ALTER TABLE "performance_tracking_settings" ADD COLUMN "handoverFieldMin" integer NOT NULL DEFAULT 10;

COMMIT;
