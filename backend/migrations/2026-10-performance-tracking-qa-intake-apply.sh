#!/usr/bin/env bash
# Performance Tracking S4: QA intake + reopen after Pass. Takes a fresh
# backup first (../../db-backup.sh) and stops if it fails. Run it BEFORE
# the deploy - the new code reads the new columns. Safe to run again: it
# skips the migration if task_reopens already exists and only reports.
# Rollback: 2026-10-performance-tracking-qa-intake.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_reopens'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-10-performance-tracking-qa-intake.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and ((table_name='task_qa_reviews' and column_name in ('testFailedReason','dependencyDeclaration','dependencyExempt')) or (table_name='team_settings' and column_name='qaTestFailedReasons') or (table_name='project_tasks' and column_name='reopenCount') or (table_name='performance_tracking_settings' and column_name='reopenWindowDays')) order by 1,2"
Q -c "select count(*) as task_reopens_columns from information_schema.columns where table_schema='public' and table_name='task_reopens'"
Q -c "select tracker_status_event_action('task_reopened_after_pass') as reopen_in_status_log"
echo "PERFORMANCE TRACKING S4 MIGRATION DONE"
