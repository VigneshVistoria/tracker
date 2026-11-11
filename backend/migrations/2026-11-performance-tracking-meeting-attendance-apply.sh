#!/usr/bin/env bash
# Performance Tracking C6: meeting attendance tables + C6 settings (switch
# OFF). Takes a fresh backup first (../../db-backup.sh) and stops if it
# fails - this is the only backup, don't run db-backup.sh before it. Run it
# BEFORE the deploy - the new code reads the new tables and columns. Safe to
# run again: it skips the migration if meeting_occurrences already exists
# and only reports.
# Rollback: 2026-11-performance-tracking-meeting-attendance.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='meeting_occurrences'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-meeting-attendance.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as c6_setting_columns from information_schema.columns where table_name='performance_tracking_settings' and column_name like 'meeting%'"
Q -c "select (select count(*) from meeting_occurrences) as occurrences, (select count(*) from meeting_attendance) as attendance_rows, (select count(*) from meeting_attendance_imports) as imports"
Q -c "select \"tenantId\", \"meetingAttendanceEnabled\" as c6_on, \"meetingAttendanceProjectIds\" as projects, \"meetingLateMinutes\" as late_min, \"meetingMinStayPercent\" as min_stay, \"meetingCountInScores\" as scored, \"meetingExcuseReasons\" as reasons, \"meetingExcuseRoles\" as excuse_roles from performance_tracking_settings"
echo "PERFORMANCE TRACKING C6 MIGRATION DONE"
