#!/usr/bin/env bash
# Generate tamper detection demo receipts for the visualizer.
# Creates valid + intentionally corrupted receipts to demonstrate signature verification.
#
# ## 👤 Autor/Developer
# Markus van Kempen
# Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
# Website: https://markusvankempen.github.io/
# No bug too small, no syntax too weird.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required (18+). Install from https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Error: Node.js 18+ required (found $(node --version))." >&2
  exit 1
fi

echo "==> provenance-addon: demo-tamper-scenarios.mjs"
node demo-tamper-scenarios.mjs
echo ""
echo "Receipts written to: receipts/tamper-demo/"
echo ""
echo "To see tamper detection in action:"
echo "  1. Open visualizer.html in a browser"
echo "  2. Load ALL files from receipts/tamper-demo/ (including _public_key.json)"
echo "  3. Tampered receipts will show orange ⚠️ TAMPERED badges"
echo "  4. Valid receipts will show green ✓ sig badges"
