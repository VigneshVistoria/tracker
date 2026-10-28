#!/usr/bin/env bash
# Performance Tracking S1 foundation: project switch columns, settings
# table, task_status_events + its triggers, and the status history rebuilt
# from audit_logs. Takes a fresh backup first (../../db-backup.sh) and stops
# if it fails. Run it BEFORE the deploy - the triggers start recording at
# once, so there is no gap and no second run is needed. Safe to run again:
# it skips the migration if the table already exists and only reports.
# Rollback: 2026-10-performance-tracking-foundation.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('task_status_events','performance_tracking_settings')")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-10-performance-tracking-foundation.sql
elif [ "$HAS" = "2" ]; then
  echo "=== Already applied - report only"
else
  echo "ABORT: only $HAS of 2 performance tracking tables exist - check by hand"; exit 1
fi

echo "=== Result"
Q -c "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name='projects' and column_name like 'performanceTracking%' order by 2"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ('task_status_events','performance_tracking_settings') group by 1 order by 1"
Q -c "select tgname, tgenabled from pg_trigger where tgname in ('TRG_project_tasks_status_event','TRG_audit_logs_link_status_event') order by 1"
Q -c "select id, name, \"performanceTrackingEnabled\" as on, \"performanceTrackingSince\" as since from projects order by id"
Q -c "select source, count(*) as events, count(\"actorUserId\") as with_actor, min(\"occurredAt\")::date as first, max(\"occurredAt\")::date as last from task_status_events group by 1 order by 1"
echo "--- Tasks whose rebuilt history does not end on their current status (should be few; listed for the record):"
Q -c "select t.id, t.status as current_status, e.\"toStatus\" as last_event from project_tasks t left join lateral (select \"toStatus\" from task_status_events e where e.\"taskId\" = t.id order by e.\"occurredAt\" desc, e.id desc limit 1) e on true where e.\"toStatus\" is distinct from t.status order by t.id"
echo "PERFORMANCE TRACKING FOUNDATION MIGRATION DONE"
