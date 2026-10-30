#!/usr/bin/env bash
# Performance Tracking B2: nightly metrics snapshot + run log.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new tables. Safe to run again: it
# skips the migration if the snapshot table already exists and only
# reports. Rollback: 2026-11-performance-tracking-metrics.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='performance_metric_snapshots'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-metrics.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ('performance_metric_snapshots','performance_metric_runs') group by 1 order by 1"
Q -c "select count(*) as unique_key from pg_indexes where indexname = 'UQ_performance_metric_snapshots_key'"
Q -c "select count(*) as checks from pg_constraint where conname in ('CHK_pms_phase','CHK_pmr_trigger','CHK_pmr_status')"
Q -c "select (select count(*) from performance_metric_snapshots) as snapshots, (select count(*) from performance_metric_runs) as runs"
echo "PERFORMANCE TRACKING B2 MIGRATION DONE"
