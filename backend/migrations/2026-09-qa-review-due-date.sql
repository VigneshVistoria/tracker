-- Adds project_tasks.qaReviewDueDate, nullable, separate from the
-- existing dueDate column (the Assignee's own one-time field). Auto-set
-- by TasksService.computeQaReviewDueDate() on every QA/Peer Review
-- submission (TaskQaReviewsService.submit()/PeerReviewsService.submit())
-- to 5 business days out, and reset fresh on every resubmission -
-- existing tasks and defects keep this NULL until their next submission,
-- nothing backfills it. See ProjectTask.qaReviewDueDate.
ALTER TABLE "project_tasks" ADD COLUMN "qaReviewDueDate" date;
