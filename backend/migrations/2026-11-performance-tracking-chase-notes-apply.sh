#!/usr/bin/env bash
# Performance Tracking B1: Chase log, progress notes, decision settings.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails.
# Run it BEFORE the deploy - the new code reads the new columns. Safe to
# run again: it skips the migration if task_chases already exists and only
# reports. Rollback: 2026-11-performance-tracking-chase-notes.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_chases'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-chase-notes.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ('task_chases','task_progress_notes') group by 1 order by 1"
Q -c "select count(*) as new_settings_columns from information_schema.columns where table_schema='public' and table_name='performance_tracking_settings' and column_name in ('blockerLagClockStart','percentBands','breachBands','nonComplianceDisplay','requestSources','chaseRoles','chaseCooldownHours','progressNoteMin')"
Q -c "select count(*) as new_checks from pg_constraint where conname in ('CHK_task_chases_not_self','CHK_pts_blocker_lag_clock','CHK_pts_non_compliance_display')"
Q -c "select (select count(*) from task_chases) as chases, (select count(*) from task_progress_notes) as notes, (select count(*) from performance_tracking_settings) as settings_rows"
echo "PERFORMANCE TRACKING B1 MIGRATION DONE"
