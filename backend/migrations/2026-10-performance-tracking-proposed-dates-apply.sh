#!/usr/bin/env bash
# Performance Tracking: proposed Due dates + 'due_committed' events. Takes a
# fresh backup first (../../db-backup.sh) and stops if it fails. Run it
# BEFORE the deploy - the new code writes the new event kind. Safe to run
# again: it skips the migration if the kind is already allowed and only
# reports. Rollback: 2026-10-performance-tracking-proposed-dates.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from pg_constraint where conname='CHK_task_commitment_events_kind' and pg_get_constraintdef(oid) like '%due_committed%'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-10-performance-tracking-proposed-dates.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select pg_get_constraintdef(oid) as kind_check from pg_constraint where conname='CHK_task_commitment_events_kind'"
Q -c "select kind, count(*) from task_commitment_events group by 1 order by 1"
echo "PROPOSED DATES MIGRATION DONE"
