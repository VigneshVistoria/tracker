#!/bin/bash
# Scheduled database backup. Dumps production Postgres (Supabase-hosted,
# Free tier - no managed backups on this plan) and uploads it to a private
# Supabase Storage bucket, since local disk on this box is too tight
# (~89% full) to accumulate backups. Run daily via cron; safe to run
# manually any time too.
#
# Only ever keeps the local dump file in /tmp, and only transiently - it
# is deleted as soon as the upload + integrity check succeed.
set -u

cd "$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(pwd)"
LOG_FILE="$REPO_ROOT/logs/backup.log"
mkdir -p "$REPO_ROOT/logs"

set -a
source backend/.env 2>/dev/null
set +a

BUCKET="db-backups"
RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-14}"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
FILENAME="tracker-db-${TIMESTAMP}.dump"
TMP_FILE="/tmp/${FILENAME}"

log_line() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOG_FILE"
}

fail() {
  echo "BACKUP FAILED: $1" >&2
  log_line "FAILED: $1"
  rm -f "$TMP_FILE"
  exit 1
}

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  fail "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set in backend/.env - backups are disabled until configured (see BACKUP_AND_ROLLBACK.md)"
fi

log_line "STARTED"

echo "=== Dumping database ==="
export PGPASSWORD="$DB_PASSWORD"
pg_dump -Fc -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -f "$TMP_FILE" 2>"$TMP_FILE.err"
DUMP_STATUS=$?
unset PGPASSWORD
if [ $DUMP_STATUS -ne 0 ]; then
  fail "pg_dump exited $DUMP_STATUS: $(cat "$TMP_FILE.err")"
fi
rm -f "$TMP_FILE.err"

echo "=== Verifying dump is structurally valid (not just created) ==="
if ! pg_restore --list "$TMP_FILE" >/dev/null 2>"$TMP_FILE.list_err"; then
  fail "pg_restore --list could not read the dump we just created - it's corrupt: $(cat "$TMP_FILE.list_err")"
fi
rm -f "$TMP_FILE.list_err"

DUMP_SIZE=$(du -h "$TMP_FILE" | cut -f1)
echo "Dump OK ($DUMP_SIZE): $FILENAME"

echo "=== Ensuring Storage bucket exists ==="
# Supabase's Storage API wraps its own errors in HTTP 400 with the real
# status in the JSON body (a plain existence-check GET returns HTTP 400
# with body statusCode "404" when missing, not a real 404) - so rather
# than trust the HTTP code from a check, just always try to create it and
# treat "already exists" as success too. Idempotent either way.
CREATE_RESP=$(curl -s \
  -X POST "$SUPABASE_URL/storage/v1/bucket" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false}")
if ! echo "$CREATE_RESP" | grep -qE '"name":"'"$BUCKET"'"|BucketAlreadyExists'; then
  fail "could not create/confirm Storage bucket $BUCKET: $CREATE_RESP"
fi

echo "=== Uploading to Supabase Storage ==="
UPLOAD_CODE=$(curl -s -o /tmp/upload_resp.json -w "%{http_code}" \
  -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$FILENAME" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$TMP_FILE")
if [ "$UPLOAD_CODE" != "200" ]; then
  fail "upload to Storage failed (HTTP $UPLOAD_CODE): $(cat /tmp/upload_resp.json)"
fi
echo "Uploaded: $FILENAME"

rm -f "$TMP_FILE"

echo "=== Applying retention (keep last $RETENTION_COUNT) ==="
LIST_JSON=$(curl -s -X POST "$SUPABASE_URL/storage/v1/object/list/$BUCKET" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"","limit":1000,"sortBy":{"column":"name","order":"desc"}}')

mapfile -t ALL_BACKUPS < <(echo "$LIST_JSON" | jq -r '.[].name' | grep '^tracker-db-' | sort -r)
TO_DELETE=("${ALL_BACKUPS[@]:$RETENTION_COUNT}")

if [ "${#TO_DELETE[@]}" -gt 0 ]; then
  DELETE_BODY=$(printf '%s\n' "${TO_DELETE[@]}" | jq -R . | jq -s '{prefixes: .}')
  curl -s -o /dev/null -X DELETE "$SUPABASE_URL/storage/v1/object/$BUCKET" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$DELETE_BODY"
  echo "Deleted ${#TO_DELETE[@]} backup(s) older than retention window: ${TO_DELETE[*]}"
else
  echo "Nothing to delete (${#ALL_BACKUPS[@]} backups on hand, retention is $RETENTION_COUNT)"
fi

log_line "SUCCESS: $FILENAME ($DUMP_SIZE)"
echo "BACKUP COMPLETE: $FILENAME"
