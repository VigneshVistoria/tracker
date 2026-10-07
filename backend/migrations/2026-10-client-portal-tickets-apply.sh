#!/usr/bin/env bash
# Client portal Stage 2: ticket conversation/history migration on production.
# Take a fresh backup first (../../db-backup.sh). Rollback:
# 2026-10-client-portal-tickets.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: Stage 1 tables present, Stage 2 not applied yet"
STAGE1=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('clients','client_tickets')")
[ "$STAGE1" = "2" ] || { echo "ABORT: Stage 1 tables missing"; exit 1; }
STAGE2=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('client_ticket_comments','client_ticket_events')")
[ "$STAGE2" = "0" ] || { echo "ABORT: Stage 2 tables already exist"; exit 1; }

echo "=== Stage 2 migration (2 new tables + new columns on portal tables only)"
Q -q -f migrations/2026-10-client-portal-tickets.sql

echo "=== Result"
Q -c "select id, name, \"ticketPrefix\", \"portalEnabled\" from clients"
Q -c "select table_name from information_schema.tables where table_schema='public' and table_name like 'client_%' order by 1"
echo "STAGE 2 MIGRATION DONE"
