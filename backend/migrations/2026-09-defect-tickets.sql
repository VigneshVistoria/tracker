-- Create Defect: QA creates a standalone ticket, always category "Defect",
-- assigned straight to a Developer with no Task Backlog step. Reuses
-- project_tasks/task_qa_reviews entirely (same Resolution+artifact gate,
-- same Pass/Failed status, same roundNumber retest counter, same KPI
-- rejection-count query - none of those have an isDefect/reviewType
-- filter, so a defect rejection counts exactly like any other,
-- automatically). No new "raised by" column - createdByUserId already
-- means that for a defect, since the creator IS the raiser.
ALTER TABLE "project_tasks" ADD COLUMN "isDefect" boolean NOT NULL DEFAULT false;
