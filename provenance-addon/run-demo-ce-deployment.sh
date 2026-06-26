#!/usr/bin/env bash
# Generate Code Engine deployment demo receipts for the visualizer.
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

echo "==> provenance-addon: demo-ce-deployment.mjs"
node demo-ce-deployment.mjs
echo ""
echo "Receipts written to: receipts/ce-deployment-demo/"
echo "Open visualizer.html and load files from that folder."
