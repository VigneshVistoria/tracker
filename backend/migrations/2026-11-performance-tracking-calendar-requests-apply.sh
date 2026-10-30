#!/usr/bin/env bash
# Performance Tracking B4: per-person calendar, leave, country holidays,
# requests (C1), overrides by named user (#3 only).
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new tables and columns. Safe to run
# again: it skips the migration if task_requests already exists and only
# reports. Rollback: 2026-11-performance-tracking-calendar-requests.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_requests'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-calendar-requests.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ('person_work_calendars','person_leave','country_holidays','task_requests') group by 1 order by 1"
Q -c "select count(*) as new_settings_columns from information_schema.columns where table_name='performance_tracking_settings' and column_name in ('overrideUserIds','calendarTimeZone','calendarWorkStart','calendarWorkEnd','calendarWeekendDays','responseTargetWorkingHours')"
Q -c "select \"tenantId\", \"overrideUserIds\", \"calendarTimeZone\", \"calendarWorkStart\", \"calendarWorkEnd\", \"calendarWeekendDays\" from performance_tracking_settings"
Q -c "select count(*) as override_audit_entries from audit_logs where \"userEmail\" = 'migration 2026-11-performance-tracking-calendar-requests'"
echo "PERFORMANCE TRACKING B4 MIGRATION DONE"
