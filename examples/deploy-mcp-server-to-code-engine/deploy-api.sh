#!/usr/bin/env bash
# =============================================================================
# deploy-api.sh — Deploy the Code Engine MCP server using IBM Cloud REST APIs
#                 directly (no ibmcloud CLI required at runtime).
#
# Author:  Markus van Kempen <markus.van.kempen@gmail.com> | <mvankempen@ca.ibm.com>
# License: MIT
# Repo:    https://github.com/markusvankempen/code-engine-mcp-server
#
# This script calls the IBM Cloud IAM and Code Engine REST APIs with curl.
# It is useful for CI/CD pipelines, containers, or any environment where
# installing the ibmcloud CLI is not practical.
#
# Pipeline:
#   1. Exchange API key for an IAM bearer token
#   2. Resolve the Code Engine project → get API base URL + GUID
#   3. Ensure the ICR pull secret exists in the project
#   4. Build the container image locally (linux/amd64) — requires Docker/Podman
#   5. Log in to ICR and push the image
#   6. Create or update the Code Engine application via REST
#   7. Poll until the application status is "ready"
#   8. Print the public HTTPS endpoint
#
# Usage:
#   chmod +x deploy-api.sh
#   IBMCLOUD_API_KEY=<key> ./deploy-api.sh
#
# All settings can be overridden with environment variables (see Config section).
#
# Prerequisites:
#   - bash 4+, curl, jq, python3 (for URL encoding — or use jq's @uri)
#   - Docker or Podman (for building and pushing the image)
#   - IBM Cloud API key with Code Engine Operator + Container Registry Writer roles
#
# Author/Developer:
#   Markus van Kempen
#   markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
#   https://markusvankempen.github.io/
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

: "${IBMCLOUD_API_KEY:?'ERROR: IBMCLOUD_API_KEY must be set'}"

CE_REGION="${CE_REGION:-ca-tor}"                         # Code Engine region
CE_PROJECT="${CE_PROJECT:-markus-app-v2-toronto}"        # CE project name
APP_NAME="${APP_NAME:-ce-mcp-remote}"                    # CE application name
ICR_HOST="${ICR_HOST:-us.icr.io}"                        # ICR hostname
ICR_NAMESPACE="${ICR_NAMESPACE:-mvk-code-engine}"        # ICR namespace
IMAGE_TAG="${IMAGE_TAG:-latest}"                         # Image tag
IMAGE_SECRET="${IMAGE_SECRET:-icr-pull-secret}"          # CE pull secret name
APP_PORT="${APP_PORT:-8080}"                             # Container port
SCALE_MIN="${SCALE_MIN:-0}"                              # Min instances
SCALE_MAX="${SCALE_MAX:-10}"                             # Max instances
CPU_LIMIT="${CPU_LIMIT:-0.5}"                            # vCPU limit
MEMORY_LIMIT="${MEMORY_LIMIT:-1G}"                       # Memory limit

# IBM Cloud API endpoints
IAM_URL="https://iam.cloud.ibm.com"
CE_API_BASE="https://api.${CE_REGION}.codeengine.cloud.ibm.com/v2"
ICR_API_BASE="https://${ICR_HOST}"

# Resolve script directory (Dockerfile context)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Full image reference
IMAGE="${ICR_HOST}/${ICR_NAMESPACE}/${APP_NAME}:${IMAGE_TAG}"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

check_prereqs() {
  log "Checking prerequisites..."
  command -v curl >/dev/null 2>&1 || fail "curl not found"
  command -v jq   >/dev/null 2>&1 || fail "jq not found. Install: brew install jq / apt-get install jq"

  if command -v docker >/dev/null 2>&1; then
    CONTAINER_RUNTIME="docker"
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_RUNTIME="podman"
  else
    fail "Neither Docker nor Podman found."
  fi
  log "Container runtime: ${CONTAINER_RUNTIME}"
}

# ── Step 1 — Get IAM token ────────────────────────────────────────────────────

get_iam_token() {
  log "Step 1/8 — Fetching IAM bearer token..."
  local response
  response=$(curl -s -X POST "${IAM_URL}/identity/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${IBMCLOUD_API_KEY}")

  IAM_TOKEN=$(echo "${response}" | jq -r '.access_token // empty')
  [ -n "${IAM_TOKEN}" ] || fail "Failed to get IAM token. Response: ${response}"
  log "IAM token: OK (expires in $(echo "${response}" | jq -r '.expires_in') s)"
}

# ── Step 2 — Resolve CE project ───────────────────────────────────────────────

resolve_project() {
  log "Step 2/8 — Resolving Code Engine project '${CE_PROJECT}'..."
  local response
  response=$(curl -s -X GET "${CE_API_BASE}/projects" \
    -H "Authorization: Bearer ${IAM_TOKEN}" \
    -H "Accept: application/json")

  CE_PROJECT_ID=$(echo "${response}" | jq -r \
    --arg name "${CE_PROJECT}" \
    '.projects[] | select(.name == $name or .id == $name) | .id // empty' | head -1)

  [ -n "${CE_PROJECT_ID}" ] || fail "Project '${CE_PROJECT}' not found in region '${CE_REGION}'. Available: $(echo "${response}" | jq -r '[.projects[].name] | join(", ")')"
  log "Project ID: ${CE_PROJECT_ID}"
}

# ── Step 3 — Ensure ICR pull secret ──────────────────────────────────────────

ensure_pull_secret() {
  log "Step 3/8 — Ensuring ICR pull secret '${IMAGE_SECRET}'..."

  # Check if secret already exists
  local status_code
  status_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X GET "${CE_API_BASE}/projects/${CE_PROJECT_ID}/secrets/${IMAGE_SECRET}" \
    -H "Authorization: Bearer ${IAM_TOKEN}" \
    -H "Accept: application/json")

  local secret_data
  secret_data=$(jq -n \
    --arg name "${IMAGE_SECRET}" \
    --arg server "${ICR_HOST}" \
    --arg key "${IBMCLOUD_API_KEY}" \
    '{
      name: $name,
      format: "registry",
      data: {
        ".dockerconfigjson": ({
          auths: {
            ($server): {
              username: "iamapikey",
              password: $key,
              auth: ("iamapikey:\($key)" | @base64)
            }
          }
        } | tostring)
      }
    }')

  if [ "${status_code}" = "200" ]; then
    log "Pull secret exists — updating..."
    curl -s -X PATCH "${CE_API_BASE}/projects/${CE_PROJECT_ID}/secrets/${IMAGE_SECRET}" \
      -H "Authorization: Bearer ${IAM_TOKEN}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "${secret_data}" >/dev/null
  else
    log "Pull secret not found — creating..."
    curl -s -X POST "${CE_API_BASE}/projects/${CE_PROJECT_ID}/secrets" \
      -H "Authorization: Bearer ${IAM_TOKEN}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "${secret_data}" >/dev/null
  fi
  log "Pull secret: OK"
}

# ── Step 4 — Build image ──────────────────────────────────────────────────────

build_image() {
  log "Step 4/8 — Building image ${IMAGE} (linux/amd64)..."
  "${CONTAINER_RUNTIME}" build \
    --platform linux/amd64 \
    -t "${IMAGE}" \
    "${SCRIPT_DIR}"
  log "Build: OK"
}

# ── Step 5 — Push image ───────────────────────────────────────────────────────

push_image() {
  log "Step 5/8 — Logging in to ICR and pushing image..."

  # ICR login via docker/podman using the API key
  echo "${IBMCLOUD_API_KEY}" | "${CONTAINER_RUNTIME}" login \
    --username iamapikey \
    --password-stdin \
    "${ICR_HOST}"

  "${CONTAINER_RUNTIME}" push "${IMAGE}"
  log "Push: OK"
}

# ── Step 6 — Create or update application ─────────────────────────────────────

deploy_app() {
  log "Step 6/8 — Deploying application '${APP_NAME}'..."

  # Build the app payload
  local app_payload
  app_payload=$(jq -n \
    --arg name    "${APP_NAME}" \
    --arg image   "${IMAGE}" \
    --arg secret  "${IMAGE_SECRET}" \
    --argjson port "${APP_PORT}" \
    --argjson min  "${SCALE_MIN}" \
    --argjson max  "${SCALE_MAX}" \
    --arg cpu     "${CPU_LIMIT}" \
    --arg mem     "${MEMORY_LIMIT}" \
    --arg region  "${CE_REGION}" \
    '{
      name: $name,
      image_reference: $image,
      image_secret: $secret,
      run_env_variables: [
        { type: "literal", name: "IBMCLOUD_REGION", value: $region }
      ],
      scale_initial_instances: $min,
      scale_min_instances: $min,
      scale_max_instances: $max,
      scale_cpu_limit: $cpu,
      scale_memory_limit: $mem,
      managed_domain_mappings: "local_public"
    }')

  # Check if app already exists
  local status_code
  status_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X GET "${CE_API_BASE}/projects/${CE_PROJECT_ID}/apps/${APP_NAME}" \
    -H "Authorization: Bearer ${IAM_TOKEN}" \
    -H "Accept: application/json")

  if [ "${status_code}" = "200" ]; then
    log "Application exists — updating (PATCH)..."
    local response
    response=$(curl -s -X PATCH \
      "${CE_API_BASE}/projects/${CE_PROJECT_ID}/apps/${APP_NAME}" \
      -H "Authorization: Bearer ${IAM_TOKEN}" \
      -H "Content-Type: application/merge-patch+json" \
      -H "Accept: application/json" \
      -d "${app_payload}")
    echo "${response}" | jq -e '.name' >/dev/null || fail "Update failed: ${response}"
  else
    log "Application not found — creating (POST)..."
    local response
    response=$(curl -s -X POST \
      "${CE_API_BASE}/projects/${CE_PROJECT_ID}/apps" \
      -H "Authorization: Bearer ${IAM_TOKEN}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "${app_payload}")
    echo "${response}" | jq -e '.name' >/dev/null || fail "Create failed: ${response}"
  fi
  log "Application deployed: OK"
}

# ── Step 7 — Poll until ready ─────────────────────────────────────────────────

wait_for_ready() {
  log "Step 7/8 — Waiting for '${APP_NAME}' to become ready (up to 3 min)..."
  local timeout=180
  local elapsed=0
  local interval=10

  while [ "${elapsed}" -lt "${timeout}" ]; do
    local response
    response=$(curl -s \
      "${CE_API_BASE}/projects/${CE_PROJECT_ID}/apps/${APP_NAME}" \
      -H "Authorization: Bearer ${IAM_TOKEN}" \
      -H "Accept: application/json")

    # Check conditions[].type == "Ready" && status == "True"
    local ready
    ready=$(echo "${response}" | jq -r '
      .status.conditions // [] |
      map(select(.type == "Ready")) |
      first | .status // "False"
    ')

    if [ "${ready}" = "True" ]; then
      log "Application is Ready!"
      CE_APP_RESPONSE="${response}"
      return 0
    fi

    local reason
    reason=$(echo "${response}" | jq -r '
      .status.conditions // [] |
      map(select(.type == "Ready")) |
      first | .reason // "Pending"
    ')
    log "  Waiting... reason=${reason} (${elapsed}s / ${timeout}s)"
    sleep "${interval}"
    elapsed=$((elapsed + interval))

    # Refresh IAM token if more than 2 min in (tokens last ~1h, but refresh anyway)
    if [ "${elapsed}" -eq 120 ]; then
      log "  Refreshing IAM token..."
      get_iam_token
    fi
  done

  log "WARNING: Timed out waiting for ready. Check the CE console."
  CE_APP_RESPONSE=$(curl -s \
    "${CE_API_BASE}/projects/${CE_PROJECT_ID}/apps/${APP_NAME}" \
    -H "Authorization: Bearer ${IAM_TOKEN}" \
    -H "Accept: application/json")
}

# ── Step 8 — Print endpoint ───────────────────────────────────────────────────

print_endpoint() {
  log "Step 8/8 — Retrieving public endpoint..."
  local endpoint
  endpoint=$(echo "${CE_APP_RESPONSE:-}" | jq -r '.endpoint // .status.url // "<not available>"')

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Deployment complete!"
  echo ""
  echo "  App:      ${APP_NAME}"
  echo "  Image:    ${IMAGE}"
  echo "  Project:  ${CE_PROJECT} (${CE_REGION})"
  echo "  ID:       ${CE_PROJECT_ID}"
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

CE_APP_RESPONSE=""

main() {
  log "=== Code Engine MCP Server — REST API deploy ==="
  log "Project:   ${CE_PROJECT} (${CE_REGION})"
  log "App:       ${APP_NAME}"
  log "Image:     ${IMAGE}"
  echo ""

  check_prereqs
  get_iam_token
  resolve_project
  ensure_pull_secret
  build_image
  push_image
  deploy_app
  wait_for_ready
  print_endpoint
}

main "$@"
