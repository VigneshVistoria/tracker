#!/usr/bin/env bash
# Dependency attachments Stage 1: per-project switch (OFF), resolver /
# resolution note columns on task_dependency_tickets, the attachments table,
# and the updated ticket sync trigger function.
# Takes a fresh backup first (../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it.
# Run it BEFORE the deploy - the new code reads the new columns.
# Safe to run again: it skips the migration if the switch column already
# exists and only reports.
# Rollback: 2026-11-dependency-attachments.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='dependencyAttachmentsEnabled'")
if [ "$HAS" = "0" ]; then
  TRG=$(Q -At -c "select count(*) from pg_proc where proname='tracker_sync_dependency_ticket'")
  if [ "$TRG" != "1" ]; then
    echo "STOPPED: tracker_sync_dependency_ticket() not found (dependency tasks migration missing?) - nothing changed."
    exit 1
  fi
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-dependency-attachments.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and ((table_name='projects' and column_name='dependencyAttachmentsEnabled') or (table_name='task_dependency_tickets' and column_name in ('resolvedByUserId','resolvedVia','resolutionNote'))) order by table_name, column_name"
Q -c "select count(*) as attachment_columns from information_schema.columns where table_schema='public' and table_name='task_dependency_ticket_attachments'"
Q -c "select conname as constraint_name from pg_constraint where conname = 'CHK_task_dependency_tickets_resolved_via'"
Q -At -c "select case when prosrc like '%resolvedVia%' then 'trigger function: updated' else 'trigger function: OLD - check' end from pg_proc where proname='tracker_sync_dependency_ticket'"
Q -c "select count(*) filter (where \"dependencyAttachmentsEnabled\") as projects_switched_on, count(*) as projects from projects"
Q -c "select status, count(*) as tickets from task_dependency_tickets group by status order by status"
echo "DEPENDENCY ATTACHMENTS MIGRATION DONE"
