#!/usr/bin/env bash
# Performance Tracking S4b: task type, requirement ID, client impact,
# improvement decision. Takes a fresh backup first (../../db-backup.sh)
# and stops if it fails. Run it BEFORE the deploy - the new code reads the
# new columns. Safe to run again: it skips the migration if the columns
# already exist and only reports.
# Rollback: 2026-10-performance-tracking-task-fields.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name='taskType'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-10-performance-tracking-task-fields.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name in ('taskType','requirementId','clientImpact','improvementDecision','improvementDecidedByUserId','improvementDecidedAt','improvementDeclineReason') order by 1"
Q -c "select conname from pg_constraint where conname in ('CHK_project_tasks_taskType','CHK_project_tasks_improvementDecision') order by 1"
Q -c "select count(*) as tasks, count(\"taskType\") as typed from project_tasks"
echo "PERFORMANCE TRACKING S4b MIGRATION DONE"
