-- Rollback for 2026-11-performance-tracking-calendar-requests.sql. Drops
-- the calendar, leave, country holiday and request tables and the new
-- settings columns (overrideRoles was never dropped, so the B3 code works
-- again). Calendars, leave, holidays and requests are lost. Deploy the
-- previous code first.
BEGIN;
DROP TABLE IF EXISTS "person_work_calendars";
DROP TABLE IF EXISTS "person_leave";
DROP TABLE IF EXISTS "country_holidays";
DROP TABLE IF EXISTS "task_requests";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "overrideUserIds";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "calendarTimeZone";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "calendarWorkStart";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "calendarWorkEnd";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "calendarWeekendDays";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "responseTargetWorkingHours";
COMMIT;
