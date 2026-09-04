#!/bin/bash
# Captures a full source-tree snapshot as a rollback point. Called by
# deploy.sh before every build, and once manually to seed a baseline.
#
# Deliberately snapshots the filesystem, not git - this box has deployed
# some past releases via a "checksummed-diff" method (git apply + MD5
# checks directly onto the live checkout, git history reconciled after the
# fact) rather than clean git commits, so a rollback mechanism that only
# understands `git checkout` can't be trusted for full fidelity. A tar
# snapshot captures exactly what's on disk regardless of how it got there.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DESCRIPTION="${1:-}"
RELEASES_DIR="/home/ec2-user/tracker-releases"
RELEASE_ID=$(date -u +%Y%m%d-%H%M%S)
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"

mkdir -p "$RELEASE_DIR"

tar -czf "$RELEASE_DIR/snapshot.tar.gz" \
  backend/src \
  backend/migrations \
  backend/package.json \
  backend/package-lock.json \
  frontend/pages \
  frontend/components \
  frontend/lib \
  frontend/styles \
  frontend/package.json \
  frontend/package-lock.json

GIT_HEAD="null"
GIT_DIRTY="true"
COMMIT_MESSAGE="null"
if git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_HEAD="\"$(git rev-parse HEAD)\""
  if [ -z "$(git status --porcelain)" ]; then
    GIT_DIRTY="false"
  else
    GIT_DIRTY="true"
  fi
  SUBJECT=$(git log -1 --pretty=%s 2>/dev/null | sed 's/"/\\"/g')
  COMMIT_MESSAGE="\"$SUBJECT\""
fi

MIGRATIONS_JSON=$(ls backend/migrations/*.sql 2>/dev/null | xargs -n1 basename 2>/dev/null | jq -R . | jq -s . )

DESC_JSON=$(printf '%s' "$DESCRIPTION" | jq -R .)

cat > "$RELEASE_DIR/meta.json" <<EOF
{
  "releaseId": "$RELEASE_ID",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitHead": $GIT_HEAD,
  "gitDirty": $GIT_DIRTY,
  "commitMessage": $COMMIT_MESSAGE,
  "description": $DESC_JSON,
  "migrations": $MIGRATIONS_JSON
}
EOF

echo "Release snapshot captured: $RELEASE_ID"
echo "$RELEASE_ID"
