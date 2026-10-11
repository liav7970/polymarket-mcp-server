#!/usr/bin/env bash
# Builds the web app and publishes it to the gh-pages branch (served by GitHub Pages).
# With a custom domain: CUSTOM_DOMAIN=cashio.example scripts/deploy-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ORIGIN=$(git config --get remote.origin.url)
REPO_NAME=$(basename -s .git "$ORIGIN")
OWNER=$(echo "$ORIGIN" | sed -E 's#.*[:/]([^/]+)/[^/]+$#\1#')

if [ -n "${CUSTOM_DOMAIN:-}" ]; then
  EXPO_BASE_URL="" scripts/build-web.sh
  echo "$CUSTOM_DOMAIN" > dist/CNAME
  URL="https://$CUSTOM_DOMAIN/"
else
  EXPO_BASE_URL="/$REPO_NAME" scripts/build-web.sh
  URL="https://$OWNER.github.io/$REPO_NAME/"
fi

TMP=$(mktemp -d)
cp -r dist/. "$TMP"
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" commit -q -m "Deploy Cashio web app"
git -C "$TMP" push -f "$ORIGIN" gh-pages
rm -rf "$TMP"

echo "Deployed: $URL"
