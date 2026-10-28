-- Performance Tracking, Wave 1 Stage S4 - QA intake + reopen after Pass
-- (2026-10-28, decisions from the user). See backend/src/tasks/qa-intake.ts.
-- Additive only: with a project's switch OFF nothing behaves differently.
--   task_qa_reviews."testFailedReason" - the reason QA picked when
--     rejecting (Test failed), as text, from the editable list
--     team_settings."qaTestFailedReasons" ('[]' = the defaults). Required
--     only while the project's tracking is ON; Peer Review never has one.
--   task_qa_reviews."dependencyDeclaration" - the developer's answer at
--     submission ("dependencies met?" + what they are still waiting on),
--     with the dependencies already recorded on the task that they picked.
--     Copied to the QA round when a PM sends the task on.
--   task_qa_reviews."dependencyExempt" - set when QA marks the round Not
--     ready because of a dependency: true if a picked dependency was
--     recorded before the submission and owned by someone else (Q1
--     protection, setting notReadyDeclaredDependencyExempt), else false.
--   project_tasks."reopenCount" + table task_reopens - PM/Admin "Reopen
--     after Pass" (from Pass or Released, back to Development, reason
--     required). Each reopen is kept with when the task passed and the
--     developer whose submission passed (charged in Q3, even if the task
--     was reassigned later). The status log records it as action
--     'task_reopened_after_pass'.
--   performance_tracking_settings."reopenWindowDays" - Q3 counts a reopen
--     within this many days of the Pass (default 30).
-- Run once (the apply script skips it if task_reopens already exists).
-- Rollback: 2026-10-performance-tracking-qa-intake.down.sql.
BEGIN;

ALTER TABLE "task_qa_reviews" ADD COLUMN "testFailedReason" character varying(100) NULL;
ALTER TABLE "task_qa_reviews" ADD COLUMN "dependencyDeclaration" jsonb NULL;
ALTER TABLE "task_qa_reviews" ADD COLUMN "dependencyExempt" boolean NULL;
ALTER TABLE "team_settings" ADD COLUMN "qaTestFailedReasons" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "project_tasks" ADD COLUMN "reopenCount" integer NOT NULL DEFAULT 0;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "reopenWindowDays" integer NOT NULL DEFAULT 30;

CREATE TABLE "task_reopens" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "fromStatus" character varying(40) NOT NULL,
  "reason" text NOT NULL,
  "reopenedByUserId" integer NOT NULL,
  "reopenedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "passedRoundId" integer,
  "passedAt" TIMESTAMP,
  "chargedUserId" integer,
  "assigneeUserId" integer,
  "previousDueDate" date,
  "proposedDueDate" date NOT NULL,
  CONSTRAINT "PK_task_reopens" PRIMARY KEY ("id")
);
CREATE INDEX "IDX_task_reopens_tenant_task" ON "task_reopens" ("tenantId", "taskId");
CREATE INDEX "IDX_task_reopens_tenant_charged" ON "task_reopens" ("tenantId", "chargedUserId");

-- The status log's action list gains the reopen (keep in step with
-- STATUS_EVENT_AUDIT_ACTIONS in src/performance-tracking/
-- performance-tracking.ts - a test checks this, the latest definition).
CREATE OR REPLACE FUNCTION tracker_status_event_action(a text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT a IN (
    'task_created', 'task_defect_created', 'task_status_changed',
    'task_qa_submitted', 'task_pm_review_submitted', 'task_peer_review_submitted',
    'task_qa_approved', 'task_qa_rejected', 'task_qa_escalated', 'task_qa_not_ready', 'task_qa_decision_reverted',
    'task_peer_review_approved', 'task_peer_review_rejected',
    'task_pm_sent_to_qa', 'task_pm_sent_back', 'task_pm_sent_back_from_qa',
    'task_returned_to_qa', 'task_return_to_qa_sent_back',
    'task_escalation_reassigned', 'task_escalation_closed_junk',
    'task_marked_junk', 'task_restored_from_junk',
    'task_held', 'task_released_from_hold', 'task_closed', 'task_reopened',
    'defect_triage_disputed', 'defect_dispute_decided',
    'task_reopened_after_pass'
  )
$$;

COMMIT;
