#!/usr/bin/env bash
# Run P2 artifact hash verification demo.
#
# ## 👤 Autor/Developer
# Markus van Kempen
# Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
# Website: https://markusvankempen.github.io/
# No bug too small, no syntax too weird.

set -euo pipefail
cd "$(dirname "$0")"
node demo-artifact-hash.mjs
