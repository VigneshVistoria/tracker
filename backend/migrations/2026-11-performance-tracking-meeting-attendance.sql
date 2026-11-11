-- Performance Tracking C6 - meeting attendance, read from Microsoft Teams
-- through Graph (2026-11-11, approved by the user). Everything is behind the
-- C6 switch (meetingAttendanceEnabled, OFF) and the C6 project list; every
-- value is an Admin setting, audited. See backend/src/meeting-attendance/.
-- Additive only.
--   performance_tracking_settings - the C6 settings:
--     "meetingAttendanceEnabled" (false) - the C6 switch
--     "meetingAttendanceProjectIds" ([]) - projects C6 is measured in
--     "meetingOrganiserUserIds" ([]) - whose Teams calendars are read
--     "meetingTrackedSeries" ([]) - the recurring meetings that count
--     "meetingLateMinutes" (5) - late = joined MORE than this after start
--     "meetingMinStayPercent" (50) - attended = stayed at least this % of it
--     "meetingMinSample" (4) - meetings before C6 shows a value
--     "meetingImportDays" (7) - how far back each import looks
--     "meetingCountInScores" (false) - C6 counts in the Collaboration score
--     "meetingExcuseReasons" (Leave, Sick, Client call)
--     "meetingExcuseRoles" (program_manager) - who can mark Excused
--   meeting_occurrences - one held meeting of a tracked series (Graph
--     event id, start/end, the attendance report read). Never deleted.
--   meeting_attendance - one invited person at one meeting: joined, left,
--     minutes, outcome (on_time / late / short / absent), and Excused
--     (reason, note, who, when). One row per person per meeting.
--   meeting_attendance_imports - every import run (nightly or "Import
--     now"): counts and any error.
-- Run once (the apply script skips it if meeting_occurrences already exists).
-- Rollback: 2026-11-performance-tracking-meeting-attendance.down.sql.
BEGIN;

ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingAttendanceEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingAttendanceProjectIds" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingOrganiserUserIds" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingTrackedSeries" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingLateMinutes" integer NOT NULL DEFAULT 5;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingMinStayPercent" integer NOT NULL DEFAULT 50;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingMinSample" integer NOT NULL DEFAULT 4;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingImportDays" integer NOT NULL DEFAULT 7;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingCountInScores" boolean NOT NULL DEFAULT false;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingExcuseReasons" jsonb NOT NULL DEFAULT '["Leave", "Sick", "Client call"]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "meetingExcuseRoles" jsonb NOT NULL DEFAULT '["program_manager"]';

CREATE TABLE "meeting_occurrences" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "organiserUserId" integer NOT NULL,
  "seriesId" character varying(512) NOT NULL,
  "eventId" character varying(512) NOT NULL,
  "subject" character varying(255) NOT NULL,
  "startAt" TIMESTAMP NOT NULL,
  "endAt" TIMESTAMP NOT NULL,
  "reportId" character varying(512) NULL,
  "status" character varying(20) NOT NULL,
  "invitedCount" integer NOT NULL DEFAULT 0,
  "importedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_meeting_occurrences" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_meeting_occurrences_event" UNIQUE ("tenantId", "eventId"),
  CONSTRAINT "CHK_meeting_occurrences_status" CHECK ("status" IN ('imported', 'no_report', 'cancelled')),
  CONSTRAINT "CHK_meeting_occurrences_times" CHECK ("endAt" > "startAt")
);
CREATE INDEX "IDX_meeting_occurrences_start" ON "meeting_occurrences" ("tenantId", "startAt");

CREATE TABLE "meeting_attendance" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "occurrenceId" integer NOT NULL,
  "userId" integer NOT NULL,
  "firstJoinAt" TIMESTAMP NULL,
  "lastLeaveAt" TIMESTAMP NULL,
  "attendedSeconds" integer NOT NULL DEFAULT 0,
  "outcome" character varying(10) NOT NULL,
  "excused" boolean NOT NULL DEFAULT false,
  "excuseReason" character varying(80) NULL,
  "excuseNote" text NULL,
  "excusedByUserId" integer NULL,
  "excusedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_meeting_attendance" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_meeting_attendance_person" UNIQUE ("occurrenceId", "userId"),
  CONSTRAINT "FK_meeting_attendance_occurrence" FOREIGN KEY ("occurrenceId") REFERENCES "meeting_occurrences"("id") ON DELETE CASCADE,
  CONSTRAINT "CHK_meeting_attendance_outcome" CHECK ("outcome" IN ('on_time', 'late', 'short', 'absent')),
  CONSTRAINT "CHK_meeting_attendance_seconds" CHECK ("attendedSeconds" >= 0),
  CONSTRAINT "CHK_meeting_attendance_excuse" CHECK (("excused" = false) OR ("excuseReason" IS NOT NULL AND "excusedByUserId" IS NOT NULL AND "excusedAt" IS NOT NULL))
);
CREATE INDEX "IDX_meeting_attendance_user" ON "meeting_attendance" ("tenantId", "userId");

CREATE TABLE "meeting_attendance_imports" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "trigger" character varying(10) NOT NULL,
  "userId" integer NULL,
  "status" character varying(10) NOT NULL,
  "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "finishedAt" TIMESTAMP NULL,
  "meetingsFound" integer NOT NULL DEFAULT 0,
  "reportsRead" integer NOT NULL DEFAULT 0,
  "rowsWritten" integer NOT NULL DEFAULT 0,
  "error" text NULL,
  CONSTRAINT "PK_meeting_attendance_imports" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_meeting_attendance_imports_trigger" CHECK ("trigger" IN ('nightly', 'manual')),
  CONSTRAINT "CHK_meeting_attendance_imports_status" CHECK ("status" IN ('running', 'done', 'failed', 'skipped'))
);
CREATE INDEX "IDX_meeting_attendance_imports_tenant" ON "meeting_attendance_imports" ("tenantId", "startedAt");

COMMIT;
