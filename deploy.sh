#!/bin/bash
# Rebuild and restart both backend and frontend, in the correct order.
#
# Root cause this exists for: on 2026-09-02, a frontend `npm run build`
# ran without an immediate `pm2 restart tracker-frontend` afterward. The
# already-running Next.js process kept serving HTML referencing the old
# build's chunk hashes, while the new build had already deleted those
# chunk files from disk - every chunk request 404'd and the app went
# blank right after login. Always deploy through this script so a build
# can never land without the matching restart.
set -e

cd "$(dirname "$0")"

echo "=== Capturing release snapshot (rollback point) ==="
bash scripts/snapshot-release.sh "deploy.sh run"

bash scripts/build-and-restart.sh

echo "=== Running post-deploy smoke check ==="
if bash scripts/smoke-check.sh; then
  echo "Deploy complete."
else
  echo ""
  echo "########################################################"
  echo "# DEPLOY FINISHED BUT SMOKE CHECK FAILED - APP MAY BE BROKEN"
  echo "# Run ./rollback.sh to revert to the previous release."
  echo "########################################################"
  exit 1
fi
