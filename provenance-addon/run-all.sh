#!/usr/bin/env bash
# Run all provenance-addon examples and demo generators.
#
# ## 👤 Autor/Developer
# Markus van Kempen
# Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
# Website: https://markusvankempen.github.io/
# No bug too small, no syntax too weird.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

bash "$SCRIPT_DIR/run-example.sh"
echo ""
bash "$SCRIPT_DIR/run-demo-ce-deployment.sh"
echo ""
bash "$SCRIPT_DIR/run-demo-multi-session.sh"
echo ""
bash "$SCRIPT_DIR/run-demo-tamper.sh"
echo ""
echo "All demos complete."
