#!/usr/bin/env bash
# Performance Tracking L3-L5: client priority tier, UAT results, release
# satisfaction + settings. Takes a fresh backup first (../../db-backup.sh)
# and stops if it fails - this is the only backup, don't run db-backup.sh
# before it. Run it BEFORE the deploy - the new code reads the new tables
# and columns. Safe to run again: it skips the migration if
# task_uat_results already exists and only reports.
# Rollback: 2026-11-performance-tracking-client-measures.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_uat_results'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-client-measures.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as tier_column from information_schema.columns where table_name='project_tasks' and column_name='clientPriorityTier'"
Q -c "select (select count(*) from task_priority_tier_events) as tier_events, (select count(*) from task_uat_results) as uat_rows, (select count(*) from release_satisfaction) as satisfaction_rows, (select count(*) from project_tasks) as tasks"
Q -c "select \"tenantId\", \"clientPriorityTiers\", jsonb_array_length(\"satisfactionQuestions\") as questions, \"clientWindowDays\", \"clientMinSample\" from performance_tracking_settings"
echo "PERFORMANCE TRACKING L3-L5 MIGRATION DONE"
