#!/usr/bin/env bash
# Builds the installable web app (iPhone: Safari → Share → Add to Home Screen) into dist/.
# Usage: EXPO_BASE_URL=/polymarket-mcp-server scripts/build-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
npx expo export --platform web --output-dir dist

python3 - <<'PY'
import re
p = 'dist/index.html'
s = open(p, encoding='utf-8').read()
s = s.replace('<html lang="en">', '<html lang="he">')
s = s.replace(
    'content="width=device-width, initial-scale=1, shrink-to-fit=no"',
    'content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"',
)
# Relative paths so the app works from any sub-path.
s = re.sub(r'<link rel="icon" href="/favicon.ico"/>', '<link rel="icon" href="favicon.ico"/>', s)
head = '''
    <link rel="manifest" href="manifest.json" />
    <link rel="apple-touch-icon" href="icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="הוצאות" />
    <meta name="theme-color" content="#F4F6FA" />
    <style>body { background: #F4F6FA; -webkit-tap-highlight-color: transparent; }</style>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
      }
    </script>
  </head>'''
s = s.replace('</head>', head, 1)
open(p, 'w', encoding='utf-8').write(s)
PY

# GitHub Pages runs Jekyll by default, which drops folders starting with "_" (like _expo/).
touch dist/.nojekyll
echo "Built dist/"
