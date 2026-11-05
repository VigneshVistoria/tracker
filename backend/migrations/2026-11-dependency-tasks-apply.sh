#!/usr/bin/env bash
# Dependency tasks Stage 1: per-project switch (OFF), task -> ticket link,
# ticket cancel fields + 'cancelled' status, and the ticket sync trigger.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it.
# Run it BEFORE the deploy - the new code reads the new columns.
# Safe to run again: it skips the migration if the switch column already
# exists and only reports.
# Rollback: 2026-11-dependency-tasks.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='dependencyTasksEnabled'")
if [ "$HAS" = "0" ]; then
  BAD=$(Q -At -c "select count(*) from task_dependency_tickets where status not in ('open','resolved')")
  if [ "$BAD" != "0" ]; then
    echo "STOPPED: $BAD dependency tickets have a status other than open/resolved - nothing changed."
    Q -c "select status, count(*) from task_dependency_tickets group by status"
    exit 1
  fi
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-dependency-tasks.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and ((table_name='projects' and column_name='dependencyTasksEnabled') or (table_name='project_tasks' and column_name='dependencyTicketId') or (table_name='task_dependency_tickets' and column_name in ('cancelledAt','cancelledByUserId','cancelReason','ownerExternal','ownerUserId','ownerEmail'))) order by table_name, column_name"
Q -c "select tgname as trigger from pg_trigger where tgname='TRG_project_tasks_sync_dependency_ticket'"
Q -c "select conname as constraint_name from pg_constraint where conname in ('FK_project_tasks_dependency_ticket','CHK_task_dependency_tickets_status','CHK_task_dependency_tickets_owner') order by 1"
Q -c "select count(*) filter (where \"dependencyTasksEnabled\") as projects_switched_on, count(*) as projects from projects"
Q -c "select status, count(*) as tickets from task_dependency_tickets group by status order by status"
echo "DEPENDENCY TASKS MIGRATION DONE"
