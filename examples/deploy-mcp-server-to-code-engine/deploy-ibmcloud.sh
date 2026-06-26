#!/usr/bin/env bash
# =============================================================================
# deploy-ibmcloud.sh — Deploy the Code Engine MCP server using the ibmcloud CLI
#
# Author:  Markus van Kempen <markus.van.kempen@gmail.com> | <mvankempen@ca.ibm.com>
# License: MIT
# Repo:    https://github.com/markusvankempen/code-engine-mcp-server
#
# Pipeline:
#   1. Log in to IBM Cloud via API key
#   2. Log in to IBM Container Registry (ICR)
#   3. Build the container image (linux/amd64)
#   4. Push the image to ICR
#   5. Target the Code Engine project
#   6. Create or update the Code Engine application
#   7. Wait for the application to be ready
#   8. Print the public HTTPS endpoint
#
# Usage:
#   chmod +x deploy-ibmcloud.sh
#   IBMCLOUD_API_KEY=<key> ./deploy-ibmcloud.sh
#
# All settings can be overridden with environment variables (see Config section).
#
# Prerequisites:
#   - ibmcloud CLI  (https://cloud.ibm.com/docs/cli)
#   - ibmcloud plugin: code-engine   (ibmcloud plugin install code-engine)
#   - ibmcloud plugin: container-registry (ibmcloud plugin install container-registry)
#   - Docker or Podman
#   - IBM Cloud API key with Code Engine Operator + Container Registry Writer roles
#
# Author/Developer:
#   Markus van Kempen
#   markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
#   https://markusvankempen.github.io/
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
# Override any of these with environment variables before running the script.

: "${IBMCLOUD_API_KEY:?'ERROR: IBMCLOUD_API_KEY must be set'}"

IBMCLOUD_REGION="${IBMCLOUD_REGION:-us-south}"          # IBM Cloud region
CE_REGION="${CE_REGION:-ca-tor}"                         # Code Engine region
CE_PROJECT="${CE_PROJECT:-markus-app-v2-toronto}"        # CE project name or ID
APP_NAME="${APP_NAME:-ce-mcp-remote}"                    # CE application name
ICR_HOST="${ICR_HOST:-us.icr.io}"                        # ICR hostname
ICR_NAMESPACE="${ICR_NAMESPACE:-mvk-code-engine}"        # ICR namespace
IMAGE_TAG="${IMAGE_TAG:-latest}"                         # Image tag
IMAGE_SECRET="${IMAGE_SECRET:-icr-pull-secret}"          # CE pull secret name
APP_PORT="${APP_PORT:-8080}"                             # Container port
SCALE_MIN="${SCALE_MIN:-0}"                              # Min instances (0 = scale to zero)
SCALE_MAX="${SCALE_MAX:-10}"                             # Max instances
CPU_LIMIT="${CPU_LIMIT:-0.5}"                            # vCPU limit
MEMORY_LIMIT="${MEMORY_LIMIT:-1G}"                       # Memory limit

# Resolve the directory that contains this script (the Dockerfile context)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Full image reference
IMAGE="${ICR_HOST}/${ICR_NAMESPACE}/${APP_NAME}:${IMAGE_TAG}"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

check_prereqs() {
  log "Checking prerequisites..."
  command -v ibmcloud >/dev/null 2>&1 || fail "ibmcloud CLI not found. Install: https://cloud.ibm.com/docs/cli"
  ibmcloud plugin list | grep -q "code-engine"         || fail "ibmcloud plugin 'code-engine' not installed. Run: ibmcloud plugin install code-engine"
  ibmcloud plugin list | grep -q "container-registry"  || fail "ibmcloud plugin 'container-registry' not installed. Run: ibmcloud plugin install container-registry"

  if command -v docker >/dev/null 2>&1; then
    CONTAINER_RUNTIME="docker"
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_RUNTIME="podman"
  else
    fail "Neither Docker nor Podman found. Install one to build container images."
  fi
  log "Container runtime: ${CONTAINER_RUNTIME}"
}

# ── Step 1 — IBM Cloud login ──────────────────────────────────────────────────

ibmcloud_login() {
  log "Step 1/8 — Logging in to IBM Cloud (region: ${IBMCLOUD_REGION})..."
  ibmcloud login \
    --apikey "${IBMCLOUD_API_KEY}" \
    -r "${IBMCLOUD_REGION}" \
    -q 2>/dev/null || ibmcloud login \
    --apikey "${IBMCLOUD_API_KEY}" \
    -r "${IBMCLOUD_REGION}"
  log "IBM Cloud login: OK"
}

# ── Step 2 — ICR login ────────────────────────────────────────────────────────

icr_login() {
  log "Step 2/8 — Logging in to ICR (${ICR_HOST})..."
  ibmcloud cr login --client "${CONTAINER_RUNTIME}"
  log "ICR login: OK"
}

# ── Step 3 — Build image ──────────────────────────────────────────────────────

build_image() {
  log "Step 3/8 — Building image ${IMAGE} (linux/amd64)..."
  "${CONTAINER_RUNTIME}" build \
    --platform linux/amd64 \
    -t "${IMAGE}" \
    "${SCRIPT_DIR}"
  log "Build: OK"
}

# ── Step 4 — Push image ───────────────────────────────────────────────────────

push_image() {
  log "Step 4/8 — Pushing ${IMAGE} to ICR..."
  "${CONTAINER_RUNTIME}" push "${IMAGE}"
  log "Push: OK"
}

# ── Step 5 — Target Code Engine project ──────────────────────────────────────

target_project() {
  log "Step 5/8 — Targeting Code Engine project '${CE_PROJECT}' (${CE_REGION})..."
  ibmcloud ce project select \
    --name "${CE_PROJECT}" \
    --region "${CE_REGION}" 2>/dev/null || \
  ibmcloud ce project select \
    --name "${CE_PROJECT}"
  log "Project targeted: OK"
}

# ── Step 6 — Ensure ICR pull secret exists ────────────────────────────────────

ensure_pull_secret() {
  log "Step 6a/8 — Checking ICR pull secret '${IMAGE_SECRET}'..."
  if ibmcloud ce secret get --name "${IMAGE_SECRET}" >/dev/null 2>&1; then
    log "Pull secret exists — refreshing credentials..."
    ibmcloud ce secret delete --name "${IMAGE_SECRET}" --force
  fi
  log "Creating pull secret '${IMAGE_SECRET}'..."
  ibmcloud ce secret create \
    --name "${IMAGE_SECRET}" \
    --format registry \
    --server "${ICR_HOST}" \
    --username iamapikey \
    --password "${IBMCLOUD_API_KEY}" \
    --email unused@example.com
  log "Pull secret: OK"
}

# ── Step 7 — Create or update the application ─────────────────────────────────

deploy_app() {
  log "Step 6b/8 — Deploying application '${APP_NAME}'..."

  # Common flags
  local flags=(
    --name "${APP_NAME}"
    --image "${IMAGE}"
    --registry-secret "${IMAGE_SECRET}"
    --port "${APP_PORT}"
    --min-scale "${SCALE_MIN}"
    --max-scale "${SCALE_MAX}"
    --cpu "${CPU_LIMIT}"
    --memory "${MEMORY_LIMIT}"
    --env "IBMCLOUD_REGION=${IBMCLOUD_REGION}"
    # Note: IBMCLOUD_API_KEY is intentionally NOT set as a CE env var.
    # The stateless bridge.mjs reads it from the Authorization header per-connection.
  )

  if ibmcloud ce app get --name "${APP_NAME}" >/dev/null 2>&1; then
    log "Application exists — updating..."
    ibmcloud ce app update "${flags[@]}"
  else
    log "Application does not exist — creating..."
    ibmcloud ce app create "${flags[@]}"
  fi
  log "Deploy command issued: OK"
}

# ── Step 8 — Wait for ready ───────────────────────────────────────────────────

wait_for_ready() {
  log "Step 7/8 — Waiting for '${APP_NAME}' to become ready (up to 3 min)..."
  local timeout=180
  local elapsed=0
  local interval=10

  while [ "${elapsed}" -lt "${timeout}" ]; do
    local status
    status=$(ibmcloud ce app get --name "${APP_NAME}" --output json 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('observedGeneration','unknown'))" 2>/dev/null || echo "unknown")

    local ready
    ready=$(ibmcloud ce app get --name "${APP_NAME}" --output json 2>/dev/null \
      | python3 -c "
import sys, json
d = json.load(sys.stdin)
conditions = d.get('status', {}).get('conditions', [])
for c in conditions:
    if c.get('type') == 'Ready':
        print(c.get('status', 'False'))
        sys.exit(0)
print('False')
" 2>/dev/null || echo "False")

    if [ "${ready}" = "True" ]; then
      log "Application is Ready!"
      break
    fi

    log "  Status: waiting... (${elapsed}s elapsed)"
    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done

  if [ "${elapsed}" -ge "${timeout}" ]; then
    log "WARNING: Timed out waiting for ready. Check: ibmcloud ce app get --name ${APP_NAME}"
  fi
}

# ── Step 9 — Print endpoint ───────────────────────────────────────────────────

print_endpoint() {
  log "Step 8/8 — Retrieving public endpoint..."
  local endpoint
  endpoint=$(ibmcloud ce app get --name "${APP_NAME}" --output json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('url','<endpoint not available yet>'))" 2>/dev/null \
    || ibmcloud ce app get --name "${APP_NAME}" | grep -E 'URL:' | awk '{print $2}')

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Deployment complete!"
  echo ""
  echo "  App:      ${APP_NAME}"
  echo "  Image:    ${IMAGE}"
  echo "  Project:  ${CE_PROJECT} (${CE_REGION})"
  echo ""
  echo "  Endpoint: ${endpoint}"
  echo "  SSE URL:  ${endpoint}/sse"
  echo "  Health:   ${endpoint}/health"
  echo ""
  echo "  Add to mcp.json / mcp_config.json:"
  echo '  {'
  echo '    "mcpServers": {'
  echo '      "code-engine-remote": {'
  echo '        "type": "sse",'
  echo "        \"serverUrl\": \"${endpoint}/sse\","
  echo '        "headers": {'
  echo '          "Authorization": "${env:IBMCLOUD_API_KEY}"'
  echo '        }'
  echo '      }'
  echo '    }'
  echo '  }'
  echo "════════════════════════════════════════════════════════"
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  log "=== Code Engine MCP Server — ibmcloud CLI deploy ==="
  log "Project:   ${CE_PROJECT} (${CE_REGION})"
  log "App:       ${APP_NAME}"
  log "Image:     ${IMAGE}"

  check_prereqs
  ibmcloud_login
  icr_login
  build_image
  push_image
  target_project
  ensure_pull_secret
  deploy_app
  wait_for_ready
  print_endpoint
}

main "$@"
