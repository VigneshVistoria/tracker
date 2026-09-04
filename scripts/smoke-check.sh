#!/bin/bash
# Post-deploy/post-rollback smoke check. Run after every deploy.sh and
# rollback.sh run, and by the Admin "Rollback" UI via POST /ops/rollback.
#
# Only ever prints "SMOKE CHECK PASSED" if both checks genuinely passed.
# Any failure prints a loud "SMOKE CHECK FAILED: <reason>" and exits 1 -
# never report success while the app is actually broken.
set -u

cd "$(dirname "${BASH_SOURCE[0]}")/.."

set -a
source backend/.env 2>/dev/null
set +a

BASE_URL="${SMOKE_CHECK_BASE_URL:-https://tracker.vistoriasystems.com}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo ""
  echo "############################################"
  echo "# SMOKE CHECK FAILED: $1"
  echo "############################################"
  echo "SMOKE_CHECK_RESULT=FAIL"
  exit 1
}

if [ -z "${SMOKE_TEST_EMAIL:-}" ] || [ -z "${SMOKE_TEST_PASSWORD:-}" ]; then
  fail "SMOKE_TEST_EMAIL/SMOKE_TEST_PASSWORD not set in backend/.env"
fi

echo "=== Smoke check against $BASE_URL ==="

# --- 1. Login endpoint ---
echo "--- Checking login ---"
LOGIN_BODY=$(printf '{"email":"%s","password":"%s"}' "$SMOKE_TEST_EMAIL" "$SMOKE_TEST_PASSWORD")
HTTP_CODE=$(curl -s -o "$TMP_DIR/login.json" -w "%{http_code}" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  -d "$LOGIN_BODY" 2>"$TMP_DIR/login.curl_err") || true

if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  fail "login request could not reach $BASE_URL ($(cat "$TMP_DIR/login.curl_err" 2>/dev/null))"
fi
if [ "$HTTP_CODE" != "200" ]; then
  fail "login returned HTTP $HTTP_CODE, expected 200 (body: $(head -c 300 "$TMP_DIR/login.json"))"
fi
if ! jq -e . "$TMP_DIR/login.json" >/dev/null 2>&1; then
  fail "login response was not valid JSON (got HTML or garbage - body: $(head -c 300 "$TMP_DIR/login.json"))"
fi
ACCESS_TOKEN=$(jq -r '.accessToken // empty' "$TMP_DIR/login.json")
if [ -z "$ACCESS_TOKEN" ]; then
  fail "login response was valid JSON but had no accessToken field"
fi
echo "Login OK (200, valid JSON, accessToken present)"

# --- 2. Dashboard page ---
echo "--- Checking dashboard page ---"
HTTP_CODE=$(curl -s -o "$TMP_DIR/dashboard.html" -w "%{http_code}" \
  --max-time 15 "$BASE_URL/dashboard" 2>"$TMP_DIR/dashboard.curl_err") || true

if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  fail "dashboard request could not reach $BASE_URL ($(cat "$TMP_DIR/dashboard.curl_err" 2>/dev/null))"
fi
if [ "$HTTP_CODE" != "200" ]; then
  fail "dashboard page returned HTTP $HTTP_CODE, expected 200"
fi

# Pull a couple of the actual /_next/static/... asset URLs the page
# references and confirm they really resolve. This is the exact failure
# mode from the 2026-09-02 incident: page returns 200 but references
# chunk files a stale/mismatched build already deleted from disk.
ASSET_PATHS=$(grep -oE '/_next/static/[^"'"'"')]+' "$TMP_DIR/dashboard.html" | sort -u | head -5)
if [ -z "$ASSET_PATHS" ]; then
  fail "dashboard page returned 200 but referenced no /_next/static/ assets at all - looks broken/blank"
fi

BROKEN_ASSETS=""
while IFS= read -r asset; do
  [ -z "$asset" ] && continue
  ASSET_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL$asset") || ASSET_CODE="000"
  if [ "$ASSET_CODE" != "200" ]; then
    BROKEN_ASSETS="$BROKEN_ASSETS $asset(=$ASSET_CODE)"
  fi
done <<< "$ASSET_PATHS"

if [ -n "$BROKEN_ASSETS" ]; then
  fail "dashboard page 200 but referenced assets 404'd/failed:$BROKEN_ASSETS - stale build vs running process mismatch"
fi
echo "Dashboard OK (200, referenced assets resolve)"

echo ""
echo "SMOKE CHECK PASSED"
echo "SMOKE_CHECK_RESULT=PASS"
exit 0
