-- Rollback for 2026-10-pm-review-gate.sql. Only safe while no task is in
-- 'Pending PM Review' / 'PM Feedback' and no 'pm' round exists (check
-- first: SELECT status, count(*) FROM project_tasks WHERE status IN
-- ('Pending PM Review','PM Feedback') GROUP BY 1;).
BEGIN;
DELETE FROM "task_status_percent_config" WHERE "status" IN ('Pending PM Review', 'PM Feedback');
ALTER TABLE "team_settings" DROP COLUMN "pmReminderWorkingDays", DROP COLUMN "pmReminderToAdmin";
ALTER TABLE "task_qa_reviews" DROP COLUMN "reminderSentAt", DROP COLUMN "adminReminderSentAt";
ALTER TABLE "project_tasks" DROP COLUMN "pmWaitWorkingDays";
ALTER TABLE "projects" DROP COLUMN "pmReviewEnabled";
COMMIT;
