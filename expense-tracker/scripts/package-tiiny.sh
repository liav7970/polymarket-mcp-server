#!/usr/bin/env bash
# Builds the web app for Tiiny Host (served from the site root) and zips it for upload.
# Upload cashio-tiiny.zip at https://tiiny.host (drag & drop the zip).
set -euo pipefail
cd "$(dirname "$0")/.."

EXPO_BASE_URL="" scripts/build-web.sh
rm -f cashio-tiiny.zip
(cd dist && python3 -c "
import os, zipfile
with zipfile.ZipFile('../cashio-tiiny.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('.'):
        for f in files:
            if f in ('.nojekyll', 'metadata.json'):
                continue
            path = os.path.join(root, f)
            z.write(path, os.path.relpath(path, '.'))
")
ls -lh cashio-tiiny.zip
