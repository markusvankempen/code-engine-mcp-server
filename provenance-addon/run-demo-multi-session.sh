#!/usr/bin/env bash
# Generate multi-session / multi-task demo receipts for the visualizer.
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

echo "==> provenance-addon: demo-multi-session.mjs"
node demo-multi-session.mjs
echo ""
echo "Receipts written to: receipts/multi-session-demo/"
echo "Open visualizer.html and load files from that folder."
