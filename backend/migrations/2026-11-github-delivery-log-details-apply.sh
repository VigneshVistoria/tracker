#!/usr/bin/env bash
# Delivery log details: 5 columns on github_webhook_deliveries (GitHub
# user, branch, PR title / commit message, workflow, task numbers).
# Takes a fresh backup first (../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code writes the new columns. Safe to run again: it
# skips the migration if the columns already exist and only reports.
# Rollback: 2026-11-github-delivery-log-details.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_name='github_webhook_deliveries' and column_name='taskIds'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-github-delivery-log-details.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select column_name, data_type, character_maximum_length, column_default from information_schema.columns where table_name='github_webhook_deliveries' and column_name in ('githubLogin','branch','title','workflowName','taskIds') order by column_name"
Q -c "select count(*) as deliveries from github_webhook_deliveries"
echo "GITHUB DELIVERY LOG DETAILS MIGRATION DONE"
