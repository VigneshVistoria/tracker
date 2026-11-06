#!/usr/bin/env bash
# Admin-configurable artifact types, Stage 1: artifact_types +
# artifact_type_rules tables (10 types seeded, no rules = all optional) and
# task_qa_review_artifacts.type enum -> varchar(60). No code reads the new
# tables yet; the running code keeps working on the varchar column.
# Takes a fresh backup first (../db-backup.sh) and stops if it fails - this
# is the only backup, don't run db-backup.sh before it. Safe to run again:
# skips the migration if artifact_types already exists and only reports.
# Rollback: 2026-11-artifact-types-config.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='artifact_types'")
if [ "$HAS" = "0" ]; then
  echo "=== Before: artifact rows by type"
  Q -c "select type::text, count(*) from task_qa_review_artifacts group by 1 order by 1"
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-artifact-types-config.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select \"tenantId\", \"sortOrder\", code, label, active from artifact_types order by 1, 2"
Q -c "select count(*) as rules from artifact_type_rules"
Q -c "select data_type, character_maximum_length from information_schema.columns where table_name='task_qa_review_artifacts' and column_name='type'"
echo "=== After: artifact rows by type"
Q -c "select type, count(*) from task_qa_review_artifacts group by 1 order by 1"
echo "ARTIFACT TYPES CONFIG STAGE 1 MIGRATION DONE"
