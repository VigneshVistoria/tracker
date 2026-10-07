#!/usr/bin/env bash
# Throwaway PostgreSQL for the backend tests - never production.
#
#   scripts/test-db.sh start   create (first time) and start it
#   scripts/test-db.sh stop    stop it
#   scripts/test-db.sh reset   stop and delete it completely
#
# Lives in backend/.test-db (git-ignored), owned by the current user, no
# sudo, no system service. Listens only on 127.0.0.1:55432 and only while
# started. Uses SSL with a throwaway self-signed certificate because the
# backend always connects over SSL (app.module.ts), so test runs exercise
# the same connection code as production.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/.test-db"
DATA="$DIR/data"
PORT="${TEST_DB_PORT:-55432}"
USER_NAME="tracker_test"
PASSWORD="tracker_test"
DB_NAME="tracker_test"

start() {
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DIR"
    initdb -D "$DATA" -U postgres --auth-local=trust --auth-host=scram-sha-256 >/dev/null
    openssl req -new -x509 -days 3650 -nodes -subj "/CN=localhost" \
      -keyout "$DATA/server.key" -out "$DATA/server.crt" >/dev/null 2>&1
    chmod 600 "$DATA/server.key"
    cat >> "$DATA/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = $PORT
unix_socket_directories = '$DIR'
ssl = on
shared_buffers = 32MB
max_connections = 30
fsync = off
synchronous_commit = off
full_page_writes = off
CONF
    FRESH=1
  fi
  if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    pg_ctl -D "$DATA" -l "$DIR/postgres.log" -w start >/dev/null
  fi
  if [ "${FRESH:-0}" = "1" ]; then
    psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE $USER_NAME LOGIN PASSWORD '$PASSWORD' CREATEDB;
CREATE DATABASE $DB_NAME OWNER $USER_NAME;
SQL
  fi
  echo "test db running on 127.0.0.1:$PORT ($DB_NAME)"
}

stop() {
  if [ -d "$DATA" ] && pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    pg_ctl -D "$DATA" -m fast -w stop >/dev/null
  fi
  echo "test db stopped"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  reset) stop; rm -rf "$DIR"; echo "test db deleted" ;;
  *) echo "usage: $0 start|stop|reset" >&2; exit 2 ;;
esac
