-- Performance Tracking C3 - weekly status report (2026-10-30, the user's
-- decisions: per-person form, deadline default Thursday 17:00 East Africa
-- Time, editable). See backend/src/weekly-status/weekly-status.ts.
-- Additive only.
--   weekly_status_reports - one per person per week (Monday): done, plan,
--     blockers, the FIRST submission time and the deadline then in force.
--   performance_tracking_settings."weeklyReportDeadlineDay" (4 = Thursday),
--     "weeklyReportDeadlineTime" ('17:00'), "weeklyReportMinLength" (20).
-- Run once (the apply script skips it if the table already exists).
-- Rollback: 2026-11-performance-tracking-weekly-status.down.sql.
BEGIN;

CREATE TABLE "weekly_status_reports" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "weekStart" date NOT NULL,
  "done" text NOT NULL,
  "plan" text NOT NULL,
  "blockers" text NULL,
  "submittedAt" TIMESTAMP NOT NULL,
  "deadlineAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL,
  CONSTRAINT "PK_weekly_status_reports" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_weekly_status_reports_week" UNIQUE ("tenantId", "userId", "weekStart"),
  CONSTRAINT "CHK_weekly_status_reports_monday" CHECK (EXTRACT(ISODOW FROM "weekStart") = 1)
);
CREATE INDEX "IDX_weekly_status_reports_week" ON "weekly_status_reports" ("tenantId", "weekStart");

ALTER TABLE "performance_tracking_settings" ADD COLUMN "weeklyReportDeadlineDay" integer NOT NULL DEFAULT 4;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "weeklyReportDeadlineTime" character varying(5) NOT NULL DEFAULT '17:00';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "weeklyReportMinLength" integer NOT NULL DEFAULT 20;
ALTER TABLE "performance_tracking_settings" ADD CONSTRAINT "CHK_pts_weeklyReportDeadlineDay" CHECK ("weeklyReportDeadlineDay" BETWEEN 0 AND 6);

COMMIT;
