#!/usr/bin/env bash
# Client portal Stage 1, step 4: foundation migration + Amanah seed on production.
# Take a fresh backup first (../../db-backup.sh). Rollback: see 2026-10-client-portal-foundation.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: portal tables must not exist yet"
EXISTING=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('clients','client_users','client_team_members','client_tickets','client_requests')")
[ "$EXISTING" = "0" ] || { echo "ABORT: $EXISTING portal table(s) already exist"; exit 1; }
Q -c "select id, name from projects where id = 2"
Q -c "select id, \"fullName\", role from users where id in (4,8,33,50) order by id"

echo "=== Foundation migration (new tables only)"
Q -q -f migrations/2026-10-client-portal-foundation.sql

echo "=== Amanah seed (self-checks: rolls back unless 1 client / 1 client user / 3 team members)"
Q -q -f migrations/2026-10-client-portal-seed-amanah.sql

echo "=== Result"
Q -c "select id, name, \"projectId\", \"keyContactUserId\", \"portalEnabled\" from clients"
Q -c "select m.\"userId\", u.\"fullName\", m.\"teamRole\" from client_team_members m join users u on u.id = m.\"userId\" order by m.\"userId\""
echo "STEP 4 DONE"
