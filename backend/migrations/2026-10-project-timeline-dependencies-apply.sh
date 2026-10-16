#!/usr/bin/env bash
# Project Timeline Stage B: one new, empty table
# (project_timeline_dependencies). Take a fresh backup first
# (../../db-backup.sh). Rollback: 2026-10-project-timeline-dependencies.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: table not there yet, timeline rows table is"
HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='project_timeline_dependencies'")
[ "$HAS" = "0" ] || { echo "ABORT: project_timeline_dependencies already exists"; exit 1; }
ROWS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='project_timeline_rows'")
[ "$ROWS" = "1" ] || { echo "ABORT: project_timeline_rows is missing"; exit 1; }

echo "=== Migration"
Q -q -f migrations/2026-10-project-timeline-dependencies.sql

echo "=== Result"
Q -c "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='project_timeline_dependencies' order by ordinal_position"
Q -c "select count(*) as rows from project_timeline_dependencies"
echo "PROJECT TIMELINE DEPENDENCIES MIGRATION DONE"
