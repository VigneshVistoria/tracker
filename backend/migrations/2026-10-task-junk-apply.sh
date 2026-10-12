#!/usr/bin/env bash
# Junk state: 5 nullable columns on project_tasks + backfill of existing
# Junk tickets. Take a fresh backup first (../../db-backup.sh). Rollback:
# 2026-10-task-junk.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: columns not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name in ('statusBeforeJunk','junkReason','junkedAt','junkedByUserId','junkedByEmail')")
[ "$HAS" = "0" ] || { echo "ABORT: junk columns already exist ($HAS of 5)"; exit 1; }
Q -c "select status, count(*) from project_tasks where status in ('Junk','Hold','Closed') group by status"

echo "=== Migration"
Q -q -f migrations/2026-10-task-junk.sql

echo "=== Result"
Q -c "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name in ('statusBeforeJunk','junkReason','junkedAt','junkedByUserId','junkedByEmail') order by 1"
Q -c "select id, title, \"statusBeforeJunk\", \"junkedByEmail\", \"junkedAt\"::timestamp(0) from project_tasks where status='Junk' order by id"
echo "JUNK MIGRATION DONE"
