-- Rollback for 2026-11-performance-tracking-meeting-attendance.sql. Drops the
-- imported meetings, attendance (including Excused marks), the import log
-- and the C6 settings (all lost). Deploy the previous code first.
BEGIN;
DROP TABLE IF EXISTS "meeting_attendance_imports";
DROP TABLE IF EXISTS "meeting_attendance";
DROP TABLE IF EXISTS "meeting_occurrences";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingExcuseRoles";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingExcuseReasons";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingCountInScores";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingImportDays";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingMinSample";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingMinStayPercent";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingLateMinutes";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingTrackedSeries";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingOrganiserUserIds";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingAttendanceProjectIds";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "meetingAttendanceEnabled";
COMMIT;
