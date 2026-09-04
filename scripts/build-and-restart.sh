#!/bin/bash
# Shared build+restart logic used by deploy.sh and rollback.sh so there is
# exactly one place that knows how to bring the app back up. Never call
# `npm run build` on its own - see CLAUDE.md for why (2026-09-02 incident).
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== Building backend ==="
(cd backend && npm run build)

echo "=== Building frontend ==="
(cd frontend && npm run build)

BACKEND_LOG=$(pm2 jlist | jq -r '.[] | select(.name=="tracker-backend") | .pm2_env.pm_out_log_path')
FRONTEND_LOG=$(pm2 jlist | jq -r '.[] | select(.name=="tracker-frontend") | .pm2_env.pm_out_log_path')

echo "=== Restarting backend ==="
pm2 flush tracker-backend >/dev/null
pm2 restart tracker-backend

echo "=== Restarting frontend ==="
pm2 flush tracker-frontend >/dev/null
pm2 restart tracker-frontend

# Don't probe the port to check readiness - during a pm2 restart the OLD
# process can still be listening and answer successfully for a moment
# after the new one has already been asked to start, so an HTTP check can
# report "ready" right before the port actually goes dark for real (old
# exiting, new not bound yet), which is exactly the gap a smoke check run
# too early would land in. Logs were just flushed above, so instead wait
# for each process's own "I'm up" log line - unambiguous, since only the
# new process can write it.
echo "=== Waiting for backend to become ready ==="
BACKEND_READY=""
for i in $(seq 1 30); do
  if grep -q "Backend running on" "$BACKEND_LOG" 2>/dev/null; then
    echo "Backend logged its startup line after ${i}s"
    BACKEND_READY="yes"
    break
  fi
  sleep 1
done
[ -z "$BACKEND_READY" ] && echo "WARNING: backend did not log its startup line within 30s"

echo "=== Waiting for frontend to become ready ==="
FRONTEND_READY=""
for i in $(seq 1 30); do
  if grep -q "Ready in" "$FRONTEND_LOG" 2>/dev/null; then
    echo "Frontend logged its startup line after ${i}s"
    FRONTEND_READY="yes"
    break
  fi
  sleep 1
done
[ -z "$FRONTEND_READY" ] && echo "WARNING: frontend did not log its startup line within 30s"

echo "=== pm2 status ==="
pm2 list

echo "=== Backend errors since restart ==="
pm2 logs tracker-backend --lines 40 --nostream | grep -iE "error|exception" || echo "none"

echo "=== Frontend errors since restart ==="
pm2 logs tracker-frontend --lines 40 --nostream | grep -iE "error|exception" || echo "none"
