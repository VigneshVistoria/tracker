#!/usr/bin/env bash
# Performance Tracking Q4: "found in production" on defects + 2 settings.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new columns. Safe to run again: it
# skips the migration if project_tasks.foundInProduction already exists and
# only reports. Rollback: 2026-11-performance-tracking-escaped-defects.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name='foundInProduction'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-escaped-defects.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as new_task_columns from information_schema.columns where table_name='project_tasks' and column_name in ('foundInProduction','escapedFromTaskId','productionReleaseDate','foundInProductionByUserId','foundInProductionAt')"
Q -c "select count(*) as new_checks from pg_constraint where conname in ('CHK_project_tasks_foundInProduction','CHK_project_tasks_escapedFromTaskId')"
Q -c "select count(*) as new_settings_columns from information_schema.columns where table_name='performance_tracking_settings' and column_name in ('escapeWindowDays','escapedPerTasks')"
Q -c "select count(*) filter (where \"isDefect\") as defects, count(*) filter (where \"foundInProduction\") as marked_found_in_production from project_tasks"
echo "PERFORMANCE TRACKING Q4 MIGRATION DONE"
