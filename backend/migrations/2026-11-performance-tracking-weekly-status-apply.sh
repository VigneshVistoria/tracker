#!/usr/bin/env bash
# Performance Tracking C3: weekly status reports + 3 settings (deadline
# Thursday 17:00, minimum length 20).
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new table and columns. Safe to run
# again: it skips the migration if weekly_status_reports already exists and
# only reports. Rollback: 2026-11-performance-tracking-weekly-status.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='weekly_status_reports'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-weekly-status.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as weekly_status_reports_columns from information_schema.columns where table_schema='public' and table_name='weekly_status_reports'"
Q -c "select \"tenantId\", \"weeklyReportDeadlineDay\", \"weeklyReportDeadlineTime\", \"weeklyReportMinLength\" from performance_tracking_settings"
echo "PERFORMANCE TRACKING C3 MIGRATION DONE"
