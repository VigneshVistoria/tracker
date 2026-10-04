#!/bin/bash
# Status Review counting test (backend/src/status-review/status-review.compute.test.ts).
# Uses Node's built-in test runner and the repo's existing TypeScript
# compiler - no test packages needed. Compiles into a throwaway temp dir,
# never into backend/dist, so it is safe to run on the live server.
set -euo pipefail

cd "$(dirname "$0")/../backend"
OUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUT_DIR"' EXIT

npx tsc --outDir "$OUT_DIR" --module commonjs --target ES2021 --esModuleInterop --skipLibCheck --types node \
  src/status-review/status-review.compute.ts src/status-review/status-review.compute.test.ts

node --test "$OUT_DIR"/status-review.compute.test.js
