-- Rollback for 2026-10-qa-decision-revert.sql. Only safe while no round
-- has been reverted yet (status 'reverted'); after that, the who/when/why
-- is still in audit_logs ('task_qa_decision_reverted').
BEGIN;
ALTER TABLE "task_qa_reviews"
  DROP COLUMN "revertedByUserId",
  DROP COLUMN "revertedAt",
  DROP COLUMN "revertReason",
  DROP COLUMN "revertedDecision";
COMMIT;
