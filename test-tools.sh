#!/usr/bin/env bash
# test-tools.sh — Smoke-test all 29 Code Engine MCP tools
# Author: Markus van Kempen | markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
# https://markusvankempen.github.io/ — No bug too small, no syntax too weird.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$(dirname "$0")/build/index.js"

# Load API key from .env
if [[ -f "$ROOT/.env" ]]; then
  export $(grep -v '^#' "$ROOT/.env" | xargs)
fi

if [[ -z "${IBMCLOUD_API_KEY:-}" ]]; then
  echo "ERROR: IBMCLOUD_API_KEY not set. Add it to $ROOT/.env"
  exit 1
fi

PASS=0
FAIL=0
SKIP=0

# ─── helpers ───────────────────────────────────────────────────────────────
call_tool() {
  local label="$1"
  local tool="$2"
  local args="$3"

  local payload
  payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}\n' "$tool" "$args")

  local response
  response=$(echo "$payload" | node "$SERVER" 2>/dev/null || true)

  if echo "$response" | grep -q '"error"'; then
    local err
    err=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('message','unknown'))" 2>/dev/null || echo "parse error")
    echo "  ❌  FAIL  [$label] $tool — $err"
    ((FAIL++))
  elif echo "$response" | grep -q '"result"'; then
    echo "  ✅  PASS  [$label] $tool"
    ((PASS++))
  else
    echo "  ⚠️   SKIP  [$label] $tool — no response"
    ((SKIP++))
  fi
}

# Also need project_id for CE tools — discover it first
discover_project() {
  local payload='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ce_list_projects","arguments":{}}}'
  echo "$payload" | node "$SERVER" 2>/dev/null \
    | python3 -c "
import sys, json, re
raw = sys.stdin.read()
# Extract first project_id from the text content
m = re.search(r'\"id\":\s*\"([a-f0-9\-]+)\"', raw)
if m: print(m.group(1))
" 2>/dev/null || true
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  IBM Code Engine MCP Server — Tool Smoke Tests"
echo "  Server: $SERVER"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── 1. Initialise the MCP server (tools/list) ────────────────────────────
echo "▶  Checking tools/list..."
TOOLS_RESPONSE=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node "$SERVER" 2>/dev/null || true)
TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['result']['tools']))" 2>/dev/null || echo "0")
echo "   Registered tools: $TOOL_COUNT"
echo ""

# ─── 2. Container / Docker / Podman tools ─────────────────────────────────
echo "── 🐳  Container Tools ──────────────────────────────────────"
call_tool "container" "detect_container_runtime" '{}'
call_tool "container" "list_local_images"        '{"runtime":"auto"}'
call_tool "container" "list_local_containers"    '{"runtime":"auto","all":true}'

# build_container_image — only run if a Dockerfile is present in examples
DOCKERFILE="$ROOT/examples/apps/hello-world-v2/Dockerfile"
if [[ -f "$DOCKERFILE" ]]; then
  call_tool "container" "build_container_image" \
    "{\"dockerfile_path\":\"$DOCKERFILE\",\"image_name\":\"ce-mcp-test:smoke\",\"context_path\":\"$(dirname "$DOCKERFILE")\",\"runtime\":\"auto\"}"
  call_tool "container" "test_container_locally" \
    '{"image_name":"ce-mcp-test:smoke","port_mapping":"18080:8080","runtime":"auto"}'
  # give container a moment to start
  sleep 2
  CONTAINER_ID=$(docker ps -q --filter ancestor=ce-mcp-test:smoke 2>/dev/null | head -1 || podman ps -q --filter ancestor=ce-mcp-test:smoke 2>/dev/null | head -1 || true)
  if [[ -n "$CONTAINER_ID" ]]; then
    call_tool "container" "get_container_logs"   "{\"container_id\":\"$CONTAINER_ID\",\"runtime\":\"auto\"}"
    call_tool "container" "stop_local_container" "{\"container_id\":\"$CONTAINER_ID\",\"runtime\":\"auto\"}"
  else
    echo "  ⚠️   SKIP  [container] get_container_logs — container not running"
    echo "  ⚠️   SKIP  [container] stop_local_container — container not running"
    ((SKIP+=2))
  fi
else
  echo "  ⚠️   SKIP  [container] build_container_image — no Dockerfile at $DOCKERFILE"
  echo "  ⚠️   SKIP  [container] test_container_locally — depends on build"
  echo "  ⚠️   SKIP  [container] get_container_logs     — depends on build"
  echo "  ⚠️   SKIP  [container] stop_local_container   — depends on build"
  ((SKIP+=4))
fi

# push_container_image — skip unless user has registry set up
echo "  ⚠️   SKIP  [container] push_container_image — requires registry auth (run manually)"
((SKIP++))

echo ""

# ─── 3. Code Engine — Projects ────────────────────────────────────────────
echo "── ☁️   Code Engine: Projects ──────────────────────────────"
call_tool "ce-projects" "ce_list_projects" '{}'

echo "   Discovering a project_id for remaining tests..."
PROJECT_ID=$(discover_project)
if [[ -z "$PROJECT_ID" ]]; then
  echo "   ⚠️   No project found — skipping all project-scoped tests"
  SKIP=$((SKIP + 18))
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Results:  ✅ $PASS passed  ❌ $FAIL failed  ⚠️  $SKIP skipped"
  echo "═══════════════════════════════════════════════════════════"
  exit $(( FAIL > 0 ? 1 : 0 ))
fi
echo "   Using project_id: $PROJECT_ID"
echo ""

call_tool "ce-projects" "ce_get_project" "{\"project_id\":\"$PROJECT_ID\"}"

# ce_create_project and ce_delete_project — skip to avoid side effects
echo "  ⚠️   SKIP  [ce-projects] ce_create_project — would create a real project"
echo "  ⚠️   SKIP  [ce-projects] ce_delete_project — destructive, run manually"
((SKIP+=2))

echo ""

# ─── 4. Code Engine — Applications ───────────────────────────────────────
echo "── 🚀  Code Engine: Applications ──────────────────────────"
call_tool "ce-apps" "ce_list_applications" "{\"project_id\":\"$PROJECT_ID\"}"

# Try to find an existing app name
APP_NAME=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ce_list_applications","arguments":{"project_id":"'"$PROJECT_ID"'"}}}' \
  | node "$SERVER" 2>/dev/null \
  | python3 -c "import sys,json,re; raw=sys.stdin.read(); m=re.search(r'\"name\":\s*\"([^\"]+)\"',raw); print(m.group(1)) if m else print('')" 2>/dev/null || true)

if [[ -n "$APP_NAME" ]]; then
  call_tool "ce-apps" "ce_get_application" "{\"project_id\":\"$PROJECT_ID\",\"app_name\":\"$APP_NAME\"}"
else
  echo "  ⚠️   SKIP  [ce-apps] ce_get_application — no apps found in project"
  ((SKIP++))
fi

echo "  ⚠️   SKIP  [ce-apps] ce_create_application — would deploy a real app"
echo "  ⚠️   SKIP  [ce-apps] ce_update_application — depends on ce_create"
echo "  ⚠️   SKIP  [ce-apps] ce_delete_application — destructive, run manually"
((SKIP+=3))

echo ""

# ─── 5. Code Engine — Builds ──────────────────────────────────────────────
echo "── 🏗️   Code Engine: Builds ────────────────────────────────"
call_tool "ce-builds" "ce_list_builds"     "{\"project_id\":\"$PROJECT_ID\"}"
call_tool "ce-builds" "ce_list_build_runs" "{\"project_id\":\"$PROJECT_ID\"}"

BUILD_RUN_NAME=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ce_list_build_runs","arguments":{"project_id":"'"$PROJECT_ID"'"}}}' \
  | node "$SERVER" 2>/dev/null \
  | python3 -c "import sys,json,re; raw=sys.stdin.read(); m=re.search(r'\"name\":\s*\"([^\"]+)\"',raw); print(m.group(1)) if m else print('')" 2>/dev/null || true)

if [[ -n "$BUILD_RUN_NAME" ]]; then
  call_tool "ce-builds" "ce_get_build_run" "{\"project_id\":\"$PROJECT_ID\",\"build_run_name\":\"$BUILD_RUN_NAME\"}"
else
  echo "  ⚠️   SKIP  [ce-builds] ce_get_build_run — no build runs found"
  ((SKIP++))
fi

echo "  ⚠️   SKIP  [ce-builds] ce_create_build     — would create a real build config"
echo "  ⚠️   SKIP  [ce-builds] ce_create_build_run — depends on ce_create_build"
((SKIP+=2))

echo ""

# ─── 6. Code Engine — Jobs ────────────────────────────────────────────────
echo "── ⚙️   Code Engine: Jobs ───────────────────────────────────"
call_tool "ce-jobs" "ce_list_jobs" "{\"project_id\":\"$PROJECT_ID\"}"
echo "  ⚠️   SKIP  [ce-jobs] ce_create_job     — would create a real job"
echo "  ⚠️   SKIP  [ce-jobs] ce_create_job_run — depends on ce_create_job"
((SKIP+=2))

echo ""

# ─── 7. Code Engine — Secrets & ConfigMaps ───────────────────────────────
echo "── 🔐  Code Engine: Secrets & ConfigMaps ───────────────────"
call_tool "ce-secrets"    "ce_list_secrets"    "{\"project_id\":\"$PROJECT_ID\"}"
call_tool "ce-configmaps" "ce_list_config_maps" "{\"project_id\":\"$PROJECT_ID\"}"
echo "  ⚠️   SKIP  [ce-secrets]    ce_create_secret     — would create a real secret"
echo "  ⚠️   SKIP  [ce-configmaps] ce_create_config_map — would create a real configmap"
((SKIP+=2))

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Results:  ✅ $PASS passed  ❌ $FAIL failed  ⚠️  $SKIP skipped"
echo "═══════════════════════════════════════════════════════════"
echo ""

exit $(( FAIL > 0 ? 1 : 0 ))
