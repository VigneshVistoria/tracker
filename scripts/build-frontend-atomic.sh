#!/bin/bash
# Builds the frontend into a fresh, disposable directory and only swaps
# it into place (a single atomic rename) once the build has fully
# succeeded. The live `.next` symlink's target is never touched while a
# build is in progress, so tracker-frontend keeps serving the last good
# build - fully intact - no matter how long the build takes or whether
# it gets interrupted partway (dropped SSH session, crashed terminal,
# etc.). This is what actually caused the recurring stale-chunk 404s: a
# plain `next build` writes in place into the same directory the running
# process was serving from, which is unsafe regardless of how reliably
# the restart step runs afterward.
#
# Never run `npm run build` directly in frontend/ - once `.next` is a
# symlink (which it is after this script's first run), a bare build
# writes straight through the symlink into whatever it currently points
# at, i.e. the live build - recreating this exact bug. Always go through
# deploy.sh.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/../frontend"

mkdir -p .next-builds
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
BUILD_DIR=".next-builds/$TIMESTAMP"

echo "=== Building frontend into $BUILD_DIR (live .next untouched) ==="
NEXT_DIST_DIR="$BUILD_DIR" npm run build

echo "=== Swapping .next atomically ==="
if [ -e ".next" ] && [ ! -L ".next" ]; then
  # One-time migration only (first run after adding this script) - a
  # plain directory can't be replaced by a symlink in a single rename,
  # so move it aside first. This is two renames back-to-back rather than
  # one, but both happen in microseconds now that the build is already
  # done - nothing like the multi-second window a full build used to
  # leave the live directory exposed for.
  echo "First atomic build - migrating the existing .next directory aside"
  mv ".next" ".next-builds/pre-atomic-baseline-$(date -u +%Y%m%d-%H%M%S)"
fi
ln -s "$BUILD_DIR" ".next.new"
mv -Tf ".next.new" ".next"

echo "=== Pruning old frontend builds (keeping last 3) ==="
ls -dt .next-builds/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo "Frontend build swapped in: $BUILD_DIR"
