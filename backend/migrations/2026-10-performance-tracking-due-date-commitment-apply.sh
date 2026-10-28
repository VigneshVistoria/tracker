#!/usr/bin/env bash
# Performance Tracking S2: committed Due date + change requests. Takes a
# fresh backup first (../../db-backup.sh) and stops if it fails. Run it
# BEFORE the deploy - the new code reads the new columns. Safe to run
# again: it skips the migration if the table already exists and only
# reports. Rollback: 2026-10-performance-tracking-due-date-commitment.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='due_date_change_requests'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-10-performance-tracking-due-date-commitment.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name like 'dueDateCommitted%' order by 1"
Q -c "select count(*) as request_table_columns from information_schema.columns where table_schema='public' and table_name='due_date_change_requests'"
Q -c "select tgname, tgenabled from pg_trigger where tgname = 'TRG_project_tasks_cancel_due_date_requests'"
Q -c "select count(*) filter (where \"dueDate\" is not null) as with_due_date, count(*) filter (where \"dueDate\" is not null and \"assigneeUserId\" is not null) as with_date_and_assignee, count(\"dueDateCommittedByUserId\") as committed from project_tasks"
echo "PERFORMANCE TRACKING S2 MIGRATION DONE"
