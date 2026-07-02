#!/usr/bin/env bash
# Serve provenance-addon for test-lab.html browser tests.
#
# ## 👤 Autor/Developer
# Markus van Kempen
# Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
# Website: https://markusvankempen.github.io/
# No bug too small, no syntax too weird.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PORT="${PORT:-8765}"
URL="http://localhost:${PORT}/test-lab.html"

echo "Provenance Test Lab"
echo "  Open: ${URL}"
echo "  Press Ctrl+C to stop"
echo ""

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server "$PORT"
else
  echo "Python not found. Install Python 3 or run: npx serve -p $PORT ." >&2
  exit 1
fi
