-- Performance Tracking O4 - escalation reason codes with an "avoidable"
-- flag (2026-10-30, fast-track; the open rules are settings with defaults,
-- listed for the Technical Director in /home/ec2-user/perf-tracking-
-- defaults.md). See backend/src/task-qa-reviews/escalation-reasons.ts.
-- Additive only: past escalations keep no reason.
--   task_qa_reviews."escalationReasonCode" / "escalationAvoidable" - the
--     reason QA picked on "Escalate to PM" (required on a tracked
--     project), and its avoidable flag AS IT WAS then.
--   performance_tracking_settings."escalationReasons" - the editable list
--     [{code, label, avoidable}]; "escalationsPerRounds" (10) - O4 is
--     reported per 10 QA rounds.
-- Run once (the apply script skips it if the column already exists).
-- Rollback: 2026-11-performance-tracking-escalation-reasons.down.sql.
BEGIN;

ALTER TABLE "task_qa_reviews" ADD COLUMN "escalationReasonCode" character varying(40) NULL;
ALTER TABLE "task_qa_reviews" ADD COLUMN "escalationAvoidable" boolean NULL;
ALTER TABLE "task_qa_reviews" ADD CONSTRAINT "CHK_task_qa_reviews_escalation_reason"
  CHECK (("escalationReasonCode" IS NULL) = ("escalationAvoidable" IS NULL));

ALTER TABLE "performance_tracking_settings" ADD COLUMN "escalationReasons" jsonb NOT NULL DEFAULT '[
  {"code": "developer_unresponsive", "label": "Developer not responding", "avoidable": true},
  {"code": "missing_information", "label": "Missing information from the developer", "avoidable": true},
  {"code": "repeated_failure", "label": "Same problem failed again", "avoidable": true},
  {"code": "requirement_unclear", "label": "Requirement unclear or disputed", "avoidable": false},
  {"code": "scope_change", "label": "Scope change needed", "avoidable": false},
  {"code": "environment", "label": "Environment or access problem", "avoidable": false},
  {"code": "other", "label": "Other", "avoidable": false}
]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "escalationsPerRounds" integer NOT NULL DEFAULT 10;

COMMIT;
