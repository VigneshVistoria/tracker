#!/usr/bin/env bash
# Project Timeline: two new tables (project_timeline_rows,
# project_timeline_teams) + Amanah/Vistoria in the Team list. Nothing
# existing is altered. Take a fresh backup first (../../db-backup.sh).
# Rollback: 2026-10-project-timeline.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: tables not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('project_timeline_rows','project_timeline_teams')")
[ "$HAS" = "0" ] || { echo "ABORT: project timeline tables already exist ($HAS of 2)"; exit 1; }

echo "=== Migration"
Q -q -f migrations/2026-10-project-timeline.sql

echo "=== Result"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ('project_timeline_rows','project_timeline_teams') group by 1 order by 1"
Q -c "select id, \"tenantId\", name, \"isActive\" from project_timeline_teams order by id"
Q -c "select count(*) as plan_rows from project_timeline_rows"
echo "PROJECT TIMELINE MIGRATION DONE"
