#!/usr/bin/env bash
# Performance metrics: 3 new tables + history backfill from audit_logs.
# Take a fresh backup first (../../db-backup.sh). Rollback:
# 2026-10-performance-metrics.down.sql.
#
# Run it twice: once before the deploy (creates the tables, fills the
# history), and once more right after the deploy - the second run skips
# the table creation and only adds events for anything that happened in
# between (nothing is ever duplicated).
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
TABLES="'task_commitment_events','performance_metric_settings','performance_holidays'"

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ($TABLES)")
if [ "$HAS" = "0" ]; then
  echo "=== Migration (creating tables)"
  Q -q -f migrations/2026-10-performance-metrics.sql
elif [ "$HAS" = "3" ]; then
  echo "=== Tables already exist - backfill only"
else
  echo "ABORT: only $HAS of 3 performance metrics tables exist - check by hand"; exit 1
fi

echo "=== Backfill from audit_logs"
Q -q -f migrations/2026-10-performance-metrics-backfill.sql

echo "=== Result"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ($TABLES) group by 1 order by 1"
Q -c "select kind, source, count(*), min(\"occurredAt\")::date as first, max(\"occurredAt\")::date as last from task_commitment_events group by 1, 2 order by 1, 2"
Q -c "select count(*) as tasks_with_due_date_but_no_due_event from project_tasks t where t.\"dueDate\" is not null and not exists (select 1 from task_commitment_events e where e.\"taskId\" = t.id and e.kind in ('due_set','due_changed'))"
echo "PERFORMANCE METRICS MIGRATION DONE"
