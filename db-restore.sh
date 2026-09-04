#!/bin/bash
# Database restore. Separate from rollback.sh on purpose - code rollback
# and DB restore are different risk levels and must not share a trigger.
#
# Default mode (--test, also the default with no flags) restores a chosen
# backup into a throwaway, disposable local Postgres instance and verifies
# it, then tears the instance down. It NEVER touches production.
#
# --production mode does the real, destructive restore against the live
# Supabase database. Requires explicit typed confirmation and always takes
# a fresh backup of current production first, so even this is undoable.
set -u

cd "$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(pwd)"
LOG_FILE="$REPO_ROOT/logs/restore.log"
mkdir -p "$REPO_ROOT/logs"

set -a
source backend/.env 2>/dev/null
set +a

BUCKET="db-backups"
MODE="test"
ARG_BACKUP_NUM=""
ARG_CONFIRM=""
ARG_ACTOR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --test) MODE="test"; shift 1 ;;
    --production) MODE="production"; shift 1 ;;
    --backup) ARG_BACKUP_NUM="$2"; shift 2 ;;
    --confirm) ARG_CONFIRM="$2"; shift 2 ;;
    --actor) ARG_ACTOR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

log_line() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] mode=$1 actor=${2:-} backup=${3:-} result=$4" >> "$LOG_FILE"
}

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set in backend/.env - restores are disabled until configured."
  exit 1
fi

echo "=== Available backups (newest first) ==="
LIST_JSON=$(curl -s -X POST "$SUPABASE_URL/storage/v1/object/list/$BUCKET" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"","limit":1000,"sortBy":{"column":"name","order":"desc"}}')

mapfile -t BACKUPS < <(echo "$LIST_JSON" | jq -r '.[].name' | grep '^tracker-db-' | sort -r)
if [ "${#BACKUPS[@]}" -eq 0 ]; then
  echo "No backups found in bucket $BUCKET."
  exit 1
fi

i=1
for b in "${BACKUPS[@]}"; do
  echo "  $i) $b"
  i=$((i + 1))
done
echo ""

if [ -n "$ARG_BACKUP_NUM" ]; then
  CHOICE="$ARG_BACKUP_NUM"
else
  read -rp "Enter backup number to restore (default 1 = newest, 'q' to quit): " CHOICE
  CHOICE="${CHOICE:-1}"
  [ "$CHOICE" = "q" ] && { echo "Aborted."; exit 0; }
fi

if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "${#BACKUPS[@]}" ]; then
  echo "Invalid backup number: $CHOICE"
  exit 2
fi
SELECTED="${BACKUPS[$((CHOICE - 1))]}"
echo "Selected: $SELECTED"

TMP_DUMP="/tmp/$SELECTED"
echo "=== Downloading $SELECTED ==="
DL_CODE=$(curl -s -o "$TMP_DUMP" -w "%{http_code}" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/storage/v1/object/$BUCKET/$SELECTED")
if [ "$DL_CODE" != "200" ]; then
  echo "Download failed (HTTP $DL_CODE)"
  log_line "$MODE" "$ARG_ACTOR" "$SELECTED" "FAILED:download"
  exit 1
fi

# ============================== TEST MODE ==============================
if [ "$MODE" = "test" ]; then
  TEST_DIR="/tmp/pg-restore-test-$(date -u +%s)"
  TEST_PORT=5433
  DB_TEST_NAME="tracker_restore_test"

  cleanup_test() {
    pg_ctl -D "$TEST_DIR" -m immediate stop >/dev/null 2>&1
    rm -rf "$TEST_DIR"
    rm -f "$TMP_DUMP"
  }
  trap cleanup_test EXIT

  echo "=== Initializing throwaway Postgres instance (never touches production) ==="
  initdb -D "$TEST_DIR" -U ec2-user --auth=trust >/dev/null

  echo "listen_addresses = 'localhost'" >> "$TEST_DIR/postgresql.conf"
  echo "port = $TEST_PORT" >> "$TEST_DIR/postgresql.conf"
  # Default unix_socket_directories (/var/run/postgresql) isn't writable
  # by this user - point it at the throwaway data dir itself instead.
  echo "unix_socket_directories = '$TEST_DIR'" >> "$TEST_DIR/postgresql.conf"

  pg_ctl -D "$TEST_DIR" -l "$TEST_DIR/server.log" start >/dev/null

  READY=""
  for i in $(seq 1 20); do
    if pg_isready -h localhost -p "$TEST_PORT" >/dev/null 2>&1; then
      READY="yes"
      break
    fi
    sleep 1
  done
  if [ -z "$READY" ]; then
    echo "Throwaway Postgres never became ready - aborting test restore."
    log_line "test" "$ARG_ACTOR" "$SELECTED" "FAILED:sandbox_did_not_start"
    exit 1
  fi

  createdb -h localhost -p "$TEST_PORT" -U ec2-user "$DB_TEST_NAME"

  echo "=== Restoring $SELECTED into throwaway instance ==="
  if ! pg_restore -h localhost -p "$TEST_PORT" -U ec2-user -d "$DB_TEST_NAME" --no-owner --no-privileges "$TMP_DUMP" 2>"$TEST_DIR/restore_err.log"; then
    # pg_restore can exit non-zero on harmless warnings (e.g. missing
    # extensions/roles) - only treat it as a real failure if no tables
    # actually landed.
    TABLE_COUNT=$(psql -h localhost -p "$TEST_PORT" -U ec2-user -d "$DB_TEST_NAME" -tAc \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
    if [ "${TABLE_COUNT:-0}" -eq 0 ]; then
      echo "pg_restore failed and no tables were created:"
      cat "$TEST_DIR/restore_err.log"
      log_line "test" "$ARG_ACTOR" "$SELECTED" "FAILED:restore_error"
      exit 1
    fi
    echo "pg_restore reported warnings (shown below) but tables were created - continuing verification:"
    cat "$TEST_DIR/restore_err.log"
  fi

  echo "=== Verifying restored data ==="
  TABLE_COUNT=$(psql -h localhost -p "$TEST_PORT" -U ec2-user -d "$DB_TEST_NAME" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
  USER_COUNT=$(psql -h localhost -p "$TEST_PORT" -U ec2-user -d "$DB_TEST_NAME" -tAc \
    "SELECT count(*) FROM users;" 2>/dev/null)

  echo "Tables restored: $TABLE_COUNT"
  echo "Rows in users table: ${USER_COUNT:-0}"

  if [ "${TABLE_COUNT:-0}" -lt 1 ] || [ -z "${USER_COUNT:-}" ]; then
    echo "RESTORE TEST FAILED: expected tables/data, found none."
    log_line "test" "$ARG_ACTOR" "$SELECTED" "FAILED:empty_after_restore"
    exit 1
  fi

  echo ""
  echo "RESTORE TEST PASSED: $SELECTED is genuinely restorable ($TABLE_COUNT tables, $USER_COUNT users)."
  log_line "test" "$ARG_ACTOR" "$SELECTED" "SUCCESS:${TABLE_COUNT}_tables_${USER_COUNT}_users"
  exit 0
fi

# ============================== PRODUCTION MODE ==============================
echo ""
echo "############################################################"
echo "# PRODUCTION RESTORE - THIS REPLACES THE LIVE DATABASE"
echo "# Target database: $DB_NAME @ $DB_HOST"
echo "# Backup to restore: $SELECTED"
echo "############################################################"

REQUIRED_PHRASE="RESTORE PRODUCTION"
if [ -n "$ARG_CONFIRM" ]; then
  if [ "$ARG_CONFIRM" != "$REQUIRED_PHRASE" ]; then
    echo "Confirmation text did not match. Refusing."
    log_line "production" "$ARG_ACTOR" "$SELECTED" "REFUSED:bad_confirmation"
    rm -f "$TMP_DUMP"
    exit 2
  fi
else
  read -rp "Type exactly \"$REQUIRED_PHRASE\" to proceed, anything else aborts: " TYPED
  if [ "$TYPED" != "$REQUIRED_PHRASE" ]; then
    echo "Aborted."
    log_line "production" "$ARG_ACTOR" "$SELECTED" "REFUSED:confirmation_aborted"
    rm -f "$TMP_DUMP"
    exit 0
  fi
fi

ACTOR="${ARG_ACTOR:-$(whoami)}"
log_line "production" "$ACTOR" "$SELECTED" "STARTED"

echo "=== Taking a fresh safety backup of current production before overwriting it ==="
if ! bash db-backup.sh; then
  echo "Pre-restore safety backup failed - refusing to proceed."
  log_line "production" "$ACTOR" "$SELECTED" "FAILED:pre_restore_backup"
  rm -f "$TMP_DUMP"
  exit 1
fi

echo "=== Restoring $SELECTED onto production ==="
export PGPASSWORD="$DB_PASSWORD"
pg_restore --clean --if-exists -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" "$TMP_DUMP"
RESTORE_STATUS=$?
unset PGPASSWORD
rm -f "$TMP_DUMP"

if [ $RESTORE_STATUS -ne 0 ]; then
  echo "pg_restore exited with warnings/errors (status $RESTORE_STATUS) - verify the database by hand immediately."
  log_line "production" "$ACTOR" "$SELECTED" "COMPLETED_WITH_WARNINGS:status_$RESTORE_STATUS"
  exit $RESTORE_STATUS
fi

log_line "production" "$ACTOR" "$SELECTED" "SUCCESS"
echo "PRODUCTION RESTORE COMPLETE from $SELECTED."
