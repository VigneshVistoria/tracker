-- "Revert QA decision" (2026-10-13, confirmed with the user): a Program
-- Manager or Admin can undo the latest QA approve/reject made by mistake.
-- The decided round is kept and marked status 'reverted' (status is a
-- plain varchar, no enum change needed); these columns record who/when/why and which decision was undone.
-- Additive and nullable only, so the running app is unaffected before and
-- after the deploy. See TaskQaReviewsService.revertDecision().
BEGIN;
ALTER TABLE "task_qa_reviews"
  ADD COLUMN "revertedByUserId" integer,
  ADD COLUMN "revertedAt" TIMESTAMP,
  ADD COLUMN "revertReason" text,
  -- the decision that was undone: 'approved' or 'rejected'
  ADD COLUMN "revertedDecision" character varying;
COMMIT;
