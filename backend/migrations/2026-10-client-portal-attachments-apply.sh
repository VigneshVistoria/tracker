#!/usr/bin/env bash
# Client portal Stage 3: attachments table on production.
# Take a fresh backup first (../../db-backup.sh). Rollback:
# 2026-10-client-portal-attachments.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: Stage 2 applied, Stage 3 not yet"
STAGE2=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('client_ticket_comments','client_ticket_events')")
[ "$STAGE2" = "2" ] || { echo "ABORT: Stage 2 tables missing"; exit 1; }
STAGE3=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name = 'client_ticket_attachments'")
[ "$STAGE3" = "0" ] || { echo "ABORT: client_ticket_attachments already exists"; exit 1; }

echo "=== Stage 3 migration (1 new table)"
Q -q -f migrations/2026-10-client-portal-attachments.sql

echo "=== Result"
Q -c "select table_name from information_schema.tables where table_schema='public' and table_name like 'client_%' order by 1"
echo "STAGE 3 MIGRATION DONE"
