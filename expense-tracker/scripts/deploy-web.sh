#!/usr/bin/env bash
# Builds the web app and publishes it to the gh-pages branch (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."

ORIGIN=$(git config --get remote.origin.url)
REPO_NAME=$(basename -s .git "$ORIGIN")
OWNER=$(echo "$ORIGIN" | sed -E 's#.*[:/]([^/]+)/[^/]+$#\1#')

EXPO_BASE_URL="/$REPO_NAME" scripts/build-web.sh

TMP=$(mktemp -d)
cp -r dist/. "$TMP"
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" commit -q -m "Deploy expense tracker web app"
git -C "$TMP" push -f "$ORIGIN" gh-pages
rm -rf "$TMP"

echo "Deployed: https://$OWNER.github.io/$REPO_NAME/"
