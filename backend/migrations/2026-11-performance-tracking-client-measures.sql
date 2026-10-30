-- Performance Tracking L3-L5 - client measures, entered by hand by the
-- Program Manager (2026-10-30, fast-track; the client's UAT process and a
-- satisfaction form are not set up yet). The open rules are settings with
-- defaults, listed for the Technical Director in /home/ec2-user/perf-
-- tracking-defaults.md. See backend/src/client-measures/client-measures.ts.
-- Additive only.
--   project_tasks."clientPriorityTier" - L3: 1 = the most urgent tier (now).
--   task_priority_tier_events - L3: every tier change (tier, previous tier,
--     who, when), so each submission is judged by the tier at that moment.
--     Never deleted.
--   task_uat_results - L4: each UAT round of a task (passed/failed, note).
--     Never deleted.
--   release_satisfaction - L5: the client's 1-5 answers for one release
--     (one per release, editable), with the questions answered.
--   performance_tracking_settings."clientPriorityTiers" (Critical, High,
--     Normal, Low), "satisfactionQuestions" (2), "clientWindowDays" (90),
--     "clientMinSample" (3).
-- Run once (the apply script skips it if task_uat_results already exists).
-- Rollback: 2026-11-performance-tracking-client-measures.down.sql.
BEGIN;

ALTER TABLE "project_tasks" ADD COLUMN "clientPriorityTier" smallint NULL;
ALTER TABLE "project_tasks" ADD CONSTRAINT "CHK_project_tasks_client_priority_tier"
  CHECK ("clientPriorityTier" IS NULL OR "clientPriorityTier" BETWEEN 1 AND 10);

CREATE TABLE "task_priority_tier_events" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "tier" smallint NULL,
  "previousTier" smallint NULL,
  "changedByUserId" integer NOT NULL,
  "changedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_task_priority_tier_events" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_task_priority_tier_events_tier" CHECK (("tier" IS NULL OR "tier" BETWEEN 1 AND 10) AND ("previousTier" IS NULL OR "previousTier" BETWEEN 1 AND 10))
);
CREATE INDEX "IDX_task_priority_tier_events_project" ON "task_priority_tier_events" ("tenantId", "projectId", "taskId", "changedAt");

CREATE TABLE "task_uat_results" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "round" integer NOT NULL,
  "result" character varying(10) NOT NULL,
  "note" text NULL,
  "recordedByUserId" integer NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_task_uat_results" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_task_uat_results_round" UNIQUE ("taskId", "round"),
  CONSTRAINT "CHK_task_uat_results_result" CHECK ("result" IN ('passed', 'failed')),
  CONSTRAINT "CHK_task_uat_results_round" CHECK ("round" >= 1)
);
CREATE INDEX "IDX_task_uat_results_project" ON "task_uat_results" ("tenantId", "projectId");

CREATE TABLE "release_satisfaction" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "releaseId" integer NOT NULL,
  "questions" jsonb NOT NULL,
  "scores" jsonb NOT NULL,
  "average" numeric(4,2) NOT NULL,
  "respondent" character varying(120) NULL,
  "comment" text NULL,
  "recordedByUserId" integer NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_release_satisfaction" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_release_satisfaction_release" UNIQUE ("releaseId"),
  CONSTRAINT "FK_release_satisfaction_release" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE,
  CONSTRAINT "CHK_release_satisfaction_average" CHECK ("average" BETWEEN 1 AND 5)
);
CREATE INDEX "IDX_release_satisfaction_project" ON "release_satisfaction" ("tenantId", "projectId");

ALTER TABLE "performance_tracking_settings" ADD COLUMN "clientPriorityTiers" jsonb NOT NULL DEFAULT '["Critical", "High", "Normal", "Low"]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "satisfactionQuestions" jsonb NOT NULL
  DEFAULT '["How satisfied are you with this release?", "How well did the team understand what you needed?"]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "clientWindowDays" integer NOT NULL DEFAULT 90;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "clientMinSample" integer NOT NULL DEFAULT 3;

COMMIT;
