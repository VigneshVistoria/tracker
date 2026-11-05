#!/usr/bin/env bash
# Design artifact types: adds 'Design file', 'Prototype', 'Design spec' to
# task_qa_reviews_artifacttype_enum (additive). Takes a fresh backup first
# (../db-backup.sh) and stops if it fails - this is the only backup, don't
# run db-backup.sh before it. Run it BEFORE the deploy. Safe to run again:
# skips when all three values already exist and only reports.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
VALUES_SQL="select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='task_qa_reviews_artifacttype_enum' and e.enumlabel in ('Design file','Prototype','Design spec')"

HAS=$(Q -At -c "$VALUES_SQL")
if [ "$HAS" != "3" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-design-artifact-types.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select e.enumlabel as artifact_type from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='task_qa_reviews_artifacttype_enum' order by e.enumsortorder"
echo "DESIGN ARTIFACT TYPES MIGRATION DONE"
