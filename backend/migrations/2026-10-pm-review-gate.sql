-- PM review gate before QA (2026-10-13, confirmed with the user).
-- Additive only: new columns are nullable or have a default, and the gate
-- is OFF for every project (pmReviewEnabled = false), so nothing changes
-- until an Admin switches a project on. See backend/src/tasks/pm-review.ts.
BEGIN;
-- Per-project switch (Admin).
ALTER TABLE "projects" ADD COLUMN "pmReviewEnabled" boolean NOT NULL DEFAULT false;
-- Working days a task waited for the PM - added to its due date so PM
-- time never counts against the developer.
ALTER TABLE "project_tasks" ADD COLUMN "pmWaitWorkingDays" integer NOT NULL DEFAULT 0;
-- Reminder stamps on a pending PM round, so each reminder goes out once.
ALTER TABLE "task_qa_reviews"
  ADD COLUMN "reminderSentAt" TIMESTAMP,
  ADD COLUMN "adminReminderSentAt" TIMESTAMP;
-- Tenant-wide reminder settings.
ALTER TABLE "team_settings"
  ADD COLUMN "pmReminderWorkingDays" integer NOT NULL DEFAULT 2,
  ADD COLUMN "pmReminderToAdmin" boolean NOT NULL DEFAULT true;
-- % Complete rows for the two new statuses, for every tenant.
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", s."status", s."percent"
FROM "tenants" t
CROSS JOIN (VALUES ('Pending PM Review', 50), ('PM Feedback', 0)) AS s("status", "percent")
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = s."status"
);
COMMIT;
