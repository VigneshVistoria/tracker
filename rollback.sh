#!/bin/bash
# Code rollback - reverts the live source tree to a previously captured
# release snapshot, rebuilds, restarts pm2, and smoke-checks the result.
#
# Interactive:      ./rollback.sh
# Non-interactive:  ./rollback.sh --release <N> --confirm ROLLBACK --actor <email>
#                    (used by the backend's POST /ops/rollback endpoint)
#
# Deliberately works from filesystem snapshots (scripts/snapshot-release.sh),
# not git history - some past releases on this box were deployed via a
# checksummed-diff patch method rather than clean commits, so this has to
# be agnostic to how code arrived. See BACKUP_AND_ROLLBACK.md.
set -u

cd "$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(pwd)"
RELEASES_DIR="/home/ec2-user/tracker-releases"
LOG_FILE="$REPO_ROOT/logs/rollback.log"
mkdir -p "$REPO_ROOT/logs"

ARG_RELEASE_NUM=""
ARG_CONFIRM=""
ARG_ACTOR=""
ARG_FORCE=""
ARG_STATUS_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --release) ARG_RELEASE_NUM="$2"; shift 2 ;;
    --confirm) ARG_CONFIRM="$2"; shift 2 ;;
    --actor) ARG_ACTOR="$2"; shift 2 ;;
    --force-across-migration) ARG_FORCE="yes"; shift 1 ;;
    --status-file) ARG_STATUS_FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

log_line() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] actor=${1} action=ROLLBACK target=${2} result=${3}" >> "$LOG_FILE"
}

# When invoked via the backend's POST /ops/rollback, this script is a
# detached child of tracker-backend - and one of its own jobs is to
# restart tracker-backend, which kills whatever process spawned it. So
# the caller can never just wait on this script's exit code/stdout; it
# polls this status file instead, written at every exit path (including
# refusals), from a process that survives even if the caller doesn't.
write_status() {
  [ -z "$ARG_STATUS_FILE" ] && return 0
  local status="$1" smoke="$2" reason="$3"
  jq -n \
    --arg status "$status" \
    --arg smoke "$smoke" \
    --arg reason "$reason" \
    --arg targetId "${TARGET_ID:-}" \
    --arg actor "${ACTOR:-${ARG_ACTOR:-$(whoami)}}" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{status: $status, smokeCheckPassed: ($smoke == "true"), reason: $reason, targetId: $targetId, actor: $actor, finishedAt: $finishedAt, auditLogged: false}' \
    > "$ARG_STATUS_FILE.tmp" && mv "$ARG_STATUS_FILE.tmp" "$ARG_STATUS_FILE"
}

# --- Build the numbered release list (newest first) ---
mapfile -t RELEASE_DIRS < <(ls -d "$RELEASES_DIR"/*/ 2>/dev/null | sort -r)
if [ "${#RELEASE_DIRS[@]}" -eq 0 ]; then
  echo "No releases found under $RELEASES_DIR - nothing to roll back to."
  write_status "error" "false" "no_releases_found"
  exit 1
fi

print_release_list() {
  echo ""
  echo "Available releases (newest first):"
  local i=1
  for dir in "${RELEASE_DIRS[@]}"; do
    local meta="$dir/meta.json"
    local id ts head dirty desc
    id=$(jq -r '.releaseId' "$meta")
    ts=$(jq -r '.timestamp' "$meta")
    head=$(jq -r '.gitHead // "n/a"' "$meta" | cut -c1-8)
    dirty=$(jq -r '.gitDirty' "$meta")
    desc=$(jq -r '.description // ""' "$meta")
    printf "  %2d) %s  %s  git=%s%s  %s\n" "$i" "$id" "$ts" "$head" "$([ "$dirty" = "true" ] && echo "(dirty)" || echo "")" "$desc"
    i=$((i + 1))
  done
  echo ""
}

print_release_list

# --- Pick target release ---
if [ -n "$ARG_RELEASE_NUM" ]; then
  CHOICE="$ARG_RELEASE_NUM"
else
  read -rp "Enter release number to roll back to (or 'q' to quit): " CHOICE
  if [ "$CHOICE" = "q" ]; then
    echo "Aborted."
    exit 0
  fi
fi

if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "${#RELEASE_DIRS[@]}" ]; then
  echo "Invalid release number: $CHOICE"
  write_status "error" "false" "invalid_release_number:$CHOICE"
  exit 2
fi

TARGET_DIR="${RELEASE_DIRS[$((CHOICE - 1))]}"
TARGET_META="$TARGET_DIR/meta.json"
TARGET_ID=$(jq -r '.releaseId' "$TARGET_META")
ACTOR="${ARG_ACTOR:-$(whoami)}"

echo ""
echo "Target release: $TARGET_ID"
echo "$(jq -r '.description' "$TARGET_META")"

# --- Migration safety check ---
mapfile -t TARGET_MIGRATIONS < <(jq -r '.migrations[]' "$TARGET_META" 2>/dev/null)
mapfile -t CURRENT_MIGRATIONS < <(ls backend/migrations/*.sql 2>/dev/null | xargs -n1 basename 2>/dev/null)

declare -A TARGET_SET
for m in "${TARGET_MIGRATIONS[@]}"; do TARGET_SET["$m"]=1; done

NEW_MIGRATIONS=()
for m in "${CURRENT_MIGRATIONS[@]}"; do
  if [ -z "${TARGET_SET[$m]:-}" ]; then
    NEW_MIGRATIONS+=("$m")
  fi
done

UNSAFE_MIGRATIONS=()
if [ "${#NEW_MIGRATIONS[@]}" -gt 0 ]; then
  echo ""
  echo "Migrations applied since this release:"
  for m in "${NEW_MIGRATIONS[@]}"; do
    down_file="backend/migrations/${m%.sql}.down.sql"
    if [ -f "$down_file" ]; then
      echo "  - $m (has down-script: OK)"
    else
      echo "  - $m (NO down-script)"
      UNSAFE_MIGRATIONS+=("$m")
    fi
  done
fi

if [ "${#UNSAFE_MIGRATIONS[@]}" -gt 0 ] && [ -z "$ARG_FORCE" ]; then
  echo ""
  echo "############################################################"
  echo "# REFUSING TO ROLL BACK"
  echo "# The following migration(s) ran after release $TARGET_ID and have"
  echo "# no down-script, so this code rollback cannot be verified safe:"
  for m in "${UNSAFE_MIGRATIONS[@]}"; do echo "#   - $m"; done
  echo "#"
  echo "# The database schema has moved forward in a way this rollback"
  echo "# cannot undo. Rolling back the code alone risks the old code"
  echo "# hitting a schema it doesn't expect."
  echo "#"
  echo "# Options: write backend/migrations/<name>.down.sql for the"
  echo "# migration(s) above, restore the database to a matching backup"
  echo "# first (db-restore.sh), or re-run with --force-across-migration"
  echo "# if you have manually verified this is safe."
  echo "############################################################"
  log_line "$ACTOR" "$TARGET_ID" "REFUSED:unsafe_migration:${UNSAFE_MIGRATIONS[*]}"
  write_status "refused" "false" "unsafe_migration:${UNSAFE_MIGRATIONS[*]}"
  exit 1
fi

# --- Confirmation ---
if [ -n "$ARG_CONFIRM" ]; then
  if [ "$ARG_CONFIRM" != "ROLLBACK" ] && [ "$ARG_CONFIRM" != "$TARGET_ID" ]; then
    echo "Confirmation text did not match. Refusing."
    log_line "$ACTOR" "$TARGET_ID" "REFUSED:bad_confirmation"
    write_status "refused" "false" "bad_confirmation"
    exit 2
  fi
else
  read -rp "Type the release id ($TARGET_ID) or the word ROLLBACK to confirm, anything else aborts: " TYPED
  if [ "$TYPED" != "ROLLBACK" ] && [ "$TYPED" != "$TARGET_ID" ]; then
    echo "Aborted - confirmation did not match."
    log_line "$ACTOR" "$TARGET_ID" "REFUSED:confirmation_aborted"
    write_status "refused" "false" "confirmation_aborted"
    exit 0
  fi
fi

log_line "$ACTOR" "$TARGET_ID" "STARTED"
write_status "running" "false" ""

# --- Always snapshot current state first, so this rollback is itself ---
# --- undoable and nothing on disk is ever silently lost.             ---
echo ""
echo "=== Snapshotting current state before rollback (safety net) ==="
bash scripts/snapshot-release.sh "pre-rollback safety snapshot (auto, before rolling back to $TARGET_ID)"

echo ""
echo "=== Reverting source tree to release $TARGET_ID ==="
for d in backend/src backend/migrations frontend/pages frontend/components frontend/lib frontend/styles; do
  rm -rf "$d"
done
tar -xzf "$TARGET_DIR/snapshot.tar.gz" -C "$REPO_ROOT"

echo "=== Reinstalling dependencies (in case they changed) ==="
(cd backend && npm install)
(cd frontend && npm install)

bash scripts/build-and-restart.sh

echo ""
echo "=== Running post-rollback smoke check ==="
if bash scripts/smoke-check.sh; then
  log_line "$ACTOR" "$TARGET_ID" "SUCCESS"
  write_status "success" "true" ""
  echo "Rollback to $TARGET_ID complete."
  exit 0
else
  log_line "$ACTOR" "$TARGET_ID" "SUCCESS_BUT_SMOKE_CHECK_FAILED"
  write_status "smoke_check_failed" "false" ""
  echo ""
  echo "########################################################"
  echo "# ROLLBACK COMPLETED BUT SMOKE CHECK STILL FAILED"
  echo "# The app may still be broken - investigate immediately."
  echo "########################################################"
  exit 1
fi
