#!/usr/bin/env bash
# Run the persisted-key demo (P1: cross-run sign + verify).
#
# ## 👤 Autor/Developer
# Markus van Kempen
# Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
# Website: https://markusvankempen.github.io/
# No bug too small, no syntax too weird.

set -euo pipefail
cd "$(dirname "$0")"
echo "▶ Running demo-persisted-key.mjs ..."
node demo-persisted-key.mjs
echo ""
echo "▶ Running standalone verifier ..."
node verify-receipt.mjs --key-dir .keys receipts/persisted-key-demo/*.json
