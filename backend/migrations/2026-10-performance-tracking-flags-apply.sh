#!/usr/bin/env bash
# Performance Tracking S3: risk/blocker flags + dependency needed-by date.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails.
# Run it BEFORE the deploy - the new code reads the new columns. Safe to
# run again: it skips the migration if the table already exists and only
# reports. Rollback: 2026-10-performance-tracking-flags.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_flags'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-10-performance-tracking-flags.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as task_flags_columns from information_schema.columns where table_schema='public' and table_name='task_flags'"
Q -c "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='task_dependency_tickets' and column_name in ('needByDate','overdueAt') order by 1"
Q -c "select tgname, tgenabled from pg_trigger where tgname = 'TRG_project_tasks_clear_task_flags'"
Q -c "select count(*) as flags, count(*) filter (where \"clearedAt\" is null) as open_flags from task_flags"
Q -c "select count(*) as dependency_tickets, count(\"needByDate\") as dated from task_dependency_tickets"
echo "PERFORMANCE TRACKING S3 MIGRATION DONE"
