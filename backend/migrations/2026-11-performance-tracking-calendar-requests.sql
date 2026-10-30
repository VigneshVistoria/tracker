-- Performance Tracking B4 (2026-10-30, fast-track plan approved by the
-- user) - per-person working calendar, leave, country holidays, requests
-- (C1 response time), and overrides by named user. See backend/src/
-- work-calendar/work-calendar.ts and backend/src/task-requests/. Additive.
--   person_work_calendars - one row per person who differs from the
--     defaults (time zone, core hours, weekend days, country). No row =
--     the tenant defaults on performance_tracking_settings (EAT,
--     07:30-15:30, Saturday + Sunday off, no country).
--   person_leave - leave entered by hand (PM/Admin), whole days, kept
--     after removal (removedAt).
--   country_holidays - holidays per country (Ethiopia, Somaliland, India),
--     entered by the PM. Starts empty. Separate from the tenant-wide
--     performance_holidays, which the Non-Compliance report uses.
--   task_requests - a request to a named person on a task (C1), or the
--     owner's response to a dependency ticket (source 'dependency').
--   performance_tracking_settings - calendar defaults, the C1 target, and
--     overrideUserIds (overrides by named user; replaces overrideRoles,
--     which stays in the table unused until B8 so the live B3 code keeps
--     working until this deploy).
-- On the user's instruction (2026-10-30) the only override user is
-- Abdirahman (#3, Technical Director) - written here with an audit entry.
-- Run once (the apply script skips it if task_requests already exists).
-- Rollback: 2026-11-performance-tracking-calendar-requests.down.sql.
BEGIN;

CREATE TABLE "person_work_calendars" (
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "timeZone" character varying(60) NOT NULL,
  "workStart" character varying(5) NOT NULL,
  "workEnd" character varying(5) NOT NULL,
  "weekendDays" jsonb NOT NULL,
  "country" character varying(20),
  "updatedByUserId" integer,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_person_work_calendars" PRIMARY KEY ("tenantId", "userId"),
  CONSTRAINT "CHK_pwc_hours" CHECK ("workStart" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "workEnd" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "workStart" < "workEnd"),
  CONSTRAINT "CHK_pwc_country" CHECK ("country" IS NULL OR "country" IN ('ethiopia', 'somaliland', 'india'))
);

CREATE TABLE "person_leave" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "startDate" date NOT NULL,
  "endDate" date NOT NULL,
  "note" text,
  "createdByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "removedByUserId" integer,
  "removedAt" TIMESTAMP,
  CONSTRAINT "PK_person_leave" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_person_leave_dates" CHECK ("endDate" >= "startDate")
);
CREATE INDEX "IDX_person_leave_user" ON "person_leave" ("tenantId", "userId");

CREATE TABLE "country_holidays" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "country" character varying(20) NOT NULL,
  "date" date NOT NULL,
  "name" character varying(200) NOT NULL,
  "createdByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_country_holidays" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_country_holidays_country" CHECK ("country" IN ('ethiopia', 'somaliland', 'india'))
);
CREATE UNIQUE INDEX "UQ_country_holidays_day" ON "country_holidays" ("tenantId", "country", "date");

CREATE TABLE "task_requests" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "source" character varying(12) NOT NULL,
  "dependencyTicketId" integer,
  "requestedOfUserId" integer NOT NULL,
  "requestedByUserId" integer NOT NULL,
  "body" text NOT NULL,
  "requestedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "respondedAt" TIMESTAMP,
  "responseBody" text,
  CONSTRAINT "PK_task_requests" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_task_requests_source" CHECK (("source" = 'request' AND "dependencyTicketId" IS NULL) OR ("source" = 'dependency' AND "dependencyTicketId" IS NOT NULL)),
  CONSTRAINT "CHK_task_requests_not_self" CHECK ("source" = 'dependency' OR "requestedOfUserId" <> "requestedByUserId")
);
CREATE INDEX "IDX_task_requests_task" ON "task_requests" ("tenantId", "taskId");
CREATE INDEX "IDX_task_requests_of" ON "task_requests" ("tenantId", "requestedOfUserId", "requestedAt");
-- One response record per dependency ticket.
CREATE UNIQUE INDEX "UQ_task_requests_dependency" ON "task_requests" ("dependencyTicketId") WHERE "dependencyTicketId" IS NOT NULL;

ALTER TABLE "performance_tracking_settings" ADD COLUMN "overrideUserIds" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "calendarTimeZone" character varying(60) NOT NULL DEFAULT 'Africa/Addis_Ababa';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "calendarWorkStart" character varying(5) NOT NULL DEFAULT '07:30';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "calendarWorkEnd" character varying(5) NOT NULL DEFAULT '15:30';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "calendarWeekendDays" jsonb NOT NULL DEFAULT '[0, 6]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "responseTargetWorkingHours" integer NOT NULL DEFAULT 4;

-- The user's instruction: overrides by Abdirahman (#3) only. Every tenant
-- that has that user gets the row (others keep the empty default).
INSERT INTO "performance_tracking_settings" ("tenantId", "overrideUserIds")
SELECT u."tenantId", '[3]'::jsonb FROM "users" u WHERE u.id = 3
ON CONFLICT ("tenantId") DO UPDATE SET "overrideUserIds" = '[3]'::jsonb, "updatedAt" = now();
INSERT INTO "audit_logs" ("userId", "userEmail", "userRole", "action", "entityType", "entityId", "details", "createdAt", "tenantId")
SELECT NULL, 'migration 2026-11-performance-tracking-calendar-requests', NULL, 'performance_tracking_settings_updated', 'PerformanceTrackingSettings', u."tenantId",
       '{"source":"migration","instructedBy":"Vignesh Selvaraj (#4), 2026-10-30","change":{"overrideUserIds":{"before":[],"after":[3]}},"note":"Overrides by named user; #3 Abdirahman, Technical Director"}',
       now(), u."tenantId"
  FROM "users" u WHERE u.id = 3;

COMMIT;
