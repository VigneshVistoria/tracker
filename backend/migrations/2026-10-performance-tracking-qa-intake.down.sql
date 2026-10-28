-- Rollback for 2026-10-performance-tracking-qa-intake.sql. Restores the
-- status log's action list and drops the reopen table and the new
-- columns (reasons, declarations, reopen history are lost; tasks reopened
-- stay where they are). Deploy the previous code first.
BEGIN;
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
    'defect_triage_disputed', 'defect_dispute_decided'
  )
$$;
DROP TABLE IF EXISTS "task_reopens";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "reopenWindowDays";
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "reopenCount";
ALTER TABLE "team_settings" DROP COLUMN IF EXISTS "qaTestFailedReasons";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "dependencyExempt";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "dependencyDeclaration";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "testFailedReason";
COMMIT;
