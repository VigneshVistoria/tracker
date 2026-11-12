#!/usr/bin/env bash
# Design handover: adds task_handovers.kind/artifacts/linkedTaskId and
# project_tasks.designHandoverId (additive). Takes a fresh backup first
# (../db-backup.sh) and stops if it fails - this is the only backup, don't
# run db-backup.sh before it. Run it BEFORE the deploy. Safe to run again:
# skips when all four columns already exist and only reports.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
COLS_SQL="select count(*) from information_schema.columns where table_schema='public' and ((table_name='task_handovers' and column_name in ('kind','artifacts','linkedTaskId')) or (table_name='project_tasks' and column_name='designHandoverId'))"

HAS=$(Q -At -c "$COLS_SQL")
if [ "$HAS" != "4" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-design-handover.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, column_name, data_type, column_default from information_schema.columns where table_schema='public' and ((table_name='task_handovers' and column_name in ('kind','artifacts','linkedTaskId')) or (table_name='project_tasks' and column_name='designHandoverId')) order by 1,2"
Q -c "select kind, count(*) from task_handovers group by kind"
echo "DESIGN HANDOVER MIGRATION DONE"
