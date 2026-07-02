# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-07-02

### Added
- **MCP Activity Dashboard** — live timeline of MCP tool calls with session grouping, idle-gap visualization, deploy outcome highlights, and optional HTTP smoke-test labels (`dashboard/`; `npm run dashboard`).
- **MCP activity logging** — when `MCP_ACTIVITY_ENABLED=true`, tool start/finish events append to `dashboard/activity/live/events.jsonl` with input summaries, pipeline sub-steps, and result highlights.
- **VS Code Activity Dashboard command** — `IBM Code Engine MCP: Open MCP Activity Dashboard` with live file-watch refresh (`codeEngineMcp.activityLiveRefresh`).
- **Deployments tab** — inventory and actions (get details, redeploy, delete) from the activity dashboard via MCP tools.

### Fixed
- **Activity logging from scripts** — `dashboard/mcp-client.mjs` now defaults `MCP_ACTIVITY_ENABLED=true` so dashboard API calls and deploy scripts emit events without extra env wiring.
- **Clear-view UX** — dashboard shows a banner when the view is filtered and offers **Show all activity** to restore older sessions.

### Changed
- **Provenance visualizer** — improved timeline UX, clearer post-clear state, and expanded chat-command docs.
- **`.env.example`** — documents optional `MCP_ACTIVITY_*` variables alongside provenance settings.
- **Bundled extension server** — synced to 1.4.0 with activity logger, dashboard support, and provenance modules.

## [1.3.0] - 2026-07-02

### Added
- **Optional provenance hooks** — when `PROVENANCE_ENABLED=true`, MCP tools emit signed receipts to `provenance-addon/receipts/live/` (`write_or_modify_file`, `proc_build_push_deploy` Dockerfile validation and deploy steps).
- **`write_or_modify_file` tool** — create or update workspace files with optional provenance receipt on completion.
- **VS Code Receipt Visualizer** — command `IBM Code Engine MCP: Open Optional Receipt Visualizer` loads receipts from `provenance-addon/receipts/live/`; optional live refresh via `codeEngineMcp.provenanceLiveRefresh` or in-panel toggle.
- **Provenance test lab & docs** — `PROVENANCE-CHAT-COMMANDS.md`, E2E flow doc, `serve-visualizer.mjs` for browser polling, CI manifest verify (`interop:ci`, `test-lab:verify`).
- **Example deploy walkthroughs** — `startrek-splash` and `starwars-splash` READMEs document MCP-only deploy flows with provenance at end.

### Fixed
- **`proc_build_push_deploy` ICR push** — login to IBM Container Registry (`podman/docker login`) before push, fixing `UNAUTHORIZED` failures.
- **`proc_build_push_deploy` provenance** — deploy success and failure paths now return `provenance_receipts` in the JSON response.

### Changed
- **Provenance documented as optional addon** — moved to end of main and example READMEs; not part of core MCP feature list.
- **Bundled extension server** — synced to 1.3.0 with provenance modules and ICR login fix.
- **Unified versioning** — `code-engine-mcp-server` (npm) and `code-engine-mcp` (VS Code extension) now share the same semver; use `npm run sync-version` before release.

## [1.2.0] - 2026-06-10

### Changed
- **License: ISC/MIT → Apache License 2.0** — all package manifests (`package.json`, `vscode-extension/package.json`, `vscode-extension/server/package.json`), `LICENSE` files, README badges, and npm/MCP Registry fields updated.
- **npm keywords expanded: 15 → 50** — aligned with GitHub Topics, VS Code Marketplace keywords, and README search terms to improve discovery across GitHub, npmjs.com, and the MCP Registry.
- **VS Code extension keywords expanded: 15 → 44** — covers all AI client names (Cursor, Copilot, Claude, Cline, Bob), domain terms, and use-case phrases for better Marketplace search ranking.
- **README SEO** — added 3-line HTML SEO comment (title · Keywords · Also phrases), visible search terms line after pitch, and Topics & keywords footer to both the MCP server README and workspace hub README.
- **`server.json` description** — rewritten to be keyword-rich and action-oriented within the MCP Registry 100-char limit.
- **GitHub repository** — description, homepage URL, and 20 GitHub Topics updated to fill all available topic slots.

## [1.1.0] - 2026-05-11

### Changed
- **Tool reduction: 109 → 67 tools** — removed six unused feature groups to reduce AI context overhead and improve signal-to-noise ratio:
  - **CE-native Builds** (10 tools): `ce_list_builds`, `ce_create_build`, `ce_get_build`, `ce_delete_build`, `ce_update_build`, `ce_create_build_run`, `ce_list_build_runs`, `ce_get_build_run`, `ce_wait_for_build_run`, `ce_validate_dockerfile`
  - **CE Functions** (6 tools): `ce_list_function_runtimes`, `ce_list_functions`, `ce_get_function`, `ce_create_function`, `ce_update_function`, `ce_delete_function`
  - **CE Fleets** (9 tools): `ce_list_fleets`, `ce_create_fleet`, `ce_get_fleet`, `ce_delete_fleet`, `ce_cancel_fleet`, `ce_list_fleet_tasks`, `ce_list_fleet_workers`, `ce_get_fleet_task`, `ce_get_fleet_worker`
  - **CE Subnet Pools** (4 tools): `ce_list_subnet_pools`, `ce_create_subnet_pool`, `ce_get_subnet_pool`, `ce_delete_subnet_pool`
  - **CE Persistent Data Stores** (4 tools): `ce_list_persistent_data_stores`, `ce_get_persistent_data_store`, `ce_create_persistent_data_store`, `ce_delete_persistent_data_store`
  - **CE Allowed Outbound Destinations** (5 tools): `ce_list_allowed_outbound_destinations`, `ce_get_allowed_outbound_destination`, `ce_create_allowed_outbound_destination`, `ce_update_allowed_outbound_destination`, `ce_delete_allowed_outbound_destination`
  - **proc_build_run_and_deploy** (1 tool): superseded by `proc_build_push_deploy`
  - All removed tools are preserved in `src/index.ts.bak` for restore if needed.

## [1.0.7] - 2026-05-10

### Security
- **Eliminated shell access** — removed `child_process.exec` entirely. All subprocess invocations now use `execFile` (does not invoke `/bin/sh`) or `spawn` with a stdin pipe for registry login. This closes command injection risk across every container tool when arguments contain shell metacharacters.
- **Input validation helpers** — added allowlist validators run before every subprocess call:
  - `validateRuntime` — only `docker` or `podman` accepted
  - `validateImageName` — `[a-zA-Z0-9._\-/:@]` only (covers digest refs and tags)
  - `validateContainerId` — alphanumeric/`_.-` only, prevents container ID injection
  - `validatePortMapping` — enforces `hostPort:containerPort` numeric format
  - `validateEnvKey` — POSIX identifier rules (`[a-zA-Z_][a-zA-Z0-9_]*`)
  - `validateRegistryHost` — hostname + optional port only
- **Registry login** — replaced `echo "${password}" | docker login` (shell string interpolation) with `spawn()` writing the credential directly to process stdin, preventing injection via API key content.

### Added
- **`ce_refresh_icr_pull_secret`** — refresh an ICR registry pull secret in Code Engine using the current API key, without requiring the `ibmcloud` CLI. Resolves `no_revision_ready` / `reason: unknown` deploy failures caused by stale or expired secrets.
- **`proc_build_push_deploy` step 4.5** — automatically refreshes the ICR pull secret before the app deploy step, preventing stale-credential failures without any manual intervention.
- **`.env.example`** — template documenting `IBMCLOUD_API_KEY` and all optional env vars (`IBMCLOUD_REGION`, `CONTAINER_RUNTIME`, `DEBUG`) with usage guidance.
- **`docs/SETUP_INSTRUCTIONS.md`** — fully rewritten: three API key storage options (shell env var, VS Code input variable, inline), step-by-step setup for five MCP clients (VS Code extension, VS Code manual, Claude Desktop, Cline, Cursor), verification steps and security checklist.
- **`docs/MCP_INSPECTOR_TROUBLESHOOTING.md`** — new `no_revision_ready` / `reason: unknown` section: Cause A (stale ICR pull secret, fix with `ce_refresh_icr_pull_secret`) and Cause B (Alpine BusyBox `sed` `\s*` vs `[[:space:]]*`).
- **37 new IBM Code Engine API tools** bringing total coverage to 95 tools:
  - **App Revisions** (`ce_list_app_revisions`, `ce_get_app_revision`, `ce_delete_app_revision`) — manage deployed revision history
  - **Update operations** (`ce_update_job`, `ce_update_build`, `ce_update_config_map`, `ce_update_domain_mapping`) — PATCH support for previously create-only resources
  - **Functions** (`ce_list_function_runtimes`, `ce_list_functions`, `ce_get_function`, `ce_create_function`, `ce_update_function`, `ce_delete_function`) — full CRUD for serverless functions
  - **Service Bindings** (`ce_list_bindings`, `ce_create_binding`, `ce_get_binding`, `ce_delete_binding`) — connect IBM Cloud services to apps/jobs/functions
  - **Project extras** (`ce_get_project_status`, `ce_list_egress_ips`) — project readiness and egress IP allowlisting
  - **Allowed Outbound Destinations** (`ce_list_allowed_outbound_destinations`, `ce_create_allowed_outbound_destination`, `ce_get_allowed_outbound_destination`, `ce_update_allowed_outbound_destination`, `ce_delete_allowed_outbound_destination`) — CIDR/FQDN egress rules
  - **Persistent Data Stores** (`ce_list_persistent_data_stores`, `ce_create_persistent_data_store`, `ce_get_persistent_data_store`, `ce_delete_persistent_data_store`) — COS bucket bindings
  - **Fleets** (`ce_list_fleets`, `ce_create_fleet`, `ce_get_fleet`, `ce_delete_fleet`, `ce_cancel_fleet`) — fleet lifecycle management
  - **Fleet Tasks** (`ce_list_fleet_tasks`, `ce_get_fleet_task`) — inspect tasks within a fleet
  - **Fleet Workers** (`ce_list_fleet_workers`, `ce_get_fleet_worker`) — inspect workers within a fleet
  - **Subnet Pools** (`ce_list_subnet_pools`, `ce_create_subnet_pool`, `ce_get_subnet_pool`, `ce_delete_subnet_pool`) — subnet pool management

### Changed
- **README** — added VS Code Marketplace, Open VSX, and npm registry badges; new "Install & Registry Links" section; API key guidance restructured as Path A (VS Code extension) and Path B (manual MCP config) with three storage options; `ce_refresh_icr_pull_secret` added to features list; tool count updated to 95.
- **`proc_build_push_deploy` `build_output`** — build and push output now includes combined stdout + stderr from `execFile` (was `exec`); build summary still shows last 20 lines.

## [1.0.6] - 2026-05-09

### Added
- **`ce_get_app_logs`** — rewritten to use the Kubernetes API proxy (`https://proxy.{region}.codeengine.cloud.ibm.com`) instead of the CE REST API, matching the mechanism used by `ibmcloud ce app logs`. Resolves 403 errors from the previous implementation.
  - New `tail_lines` parameter (default 100) to control log output length
  - `instance_name` is now optional; when omitted, logs are fetched for all running pods
  - Pod discovery uses `labelSelector=serving.knative.dev/service={app_name}` against the Kubernetes pods API
- **MCP Inspector troubleshooting guide** — `docs/MCP_INSPECTOR_TROUBLESHOOTING.md` with step-by-step instructions, screenshots, common error table, and JSON-RPC handshake explanation
- **`docs/images/`** — screenshots of the MCP Inspector connected to the local server via STDIO (setup, connected, tool result)
- **`examples/mcp-server-supergateway/`** — added "Verifying with the MCP Inspector" section to README with screenshots of the live Code Engine SSE endpoint

### Fixed
- `ce_get_app_logs` no longer returns 403; IAM Bearer token is accepted directly by the Kubernetes proxy without OIDC exchange or kubeconfig

## [1.0.3] - 2026-05-08

### Added
- **`ce_validate_dockerfile`** — new tool that checks a Dockerfile for IBM Code Engine compatibility before building:
  - Architecture: detects wrong `--platform` values (must be `linux/amd64`)
  - Port: verifies `EXPOSE` matches the configured app port (default 8080); errors on port 80
  - nginx sed patterns: flags fragile exact-whitespace `listen  80;` patterns that silently fail on `nginx:alpine`; recommends `[[:space:]]*` form
  - Base image: warns on ARM-specific images and untagged `latest`
  - Security: warns when no non-root `USER` is set
  - Runtime: warns on missing `CMD`/`ENTRYPOINT`
- **`proc_build_push_deploy`** — now runs Dockerfile pre-flight validation (architecture, port, nginx sed) before building; aborts with clear error messages if errors are found
- **Build/deploy progress visibility** across all long-running operations:
  - `ce_wait_for_app_ready` — returns `poll_history: [{elapsed_s, status, reason, revision}]` showing every status transition
  - `ce_wait_for_build_run` — returns `poll_history: [{elapsed_s, status, reason}]` (only logs on status change to keep output compact)
  - `proc_build_push_deploy` — captures full `podman`/`docker` build and push output (stdout + stderr combined) in `steps[]`; returns `poll_history` in final result
  - `proc_build_run_and_deploy` — returns `build_poll_history` and `app_poll_history` with inline timing summary in steps
- **`build_container_image`** — renamed `error` field to `build_output` (combined stdout + stderr); container runtimes write build progress to stderr so the old label was misleading
- **`resolveProjectId()`** — accepts project name or UUID; searches all CE regions by name (case-insensitive); errors clearly on 0 or multiple matches
- **`icr_create_namespace`** — create a new ICR namespace via REST API
- **`iam_get_token_info`** — inspect current IAM token: account ID, expiry, validity, scopes
- **`ce_update_secret`** — PATCH an existing secret in-place (fetches `entity_tag` automatically)
- **`ce_renew_tls_secret_from_pem`** — patch an existing TLS secret from updated PEM files without disrupting domain mappings
- **`ce_wait_for_app_ready`** — poll app status until `ready`/`failed`/timeout
- **`ce_wait_for_build_run`** — poll build run until `succeeded`/`failed`/timeout
- **`proc_build_push_deploy`** — full container pipeline: auto-detect runtime → build `linux/amd64` → push to ICR → create/update CE app → wait → return URL. Accepts project name or ID; derives ICR image path from namespace + app name + tag
- **`proc_setup_custom_domain`** — read PEM files → create TLS secret → create domain mapping → return CNAME target
- **`proc_build_run_and_deploy`** — start CE source build run → wait → create/update app → wait → return URL
- **Examples** — added `examples/developer-splash/` (dark-mode nginx profile card) with Dockerfile, HTML, and README; fixed `examples/starwars-splash/Dockerfile` to use portable `[[:space:]]*` sed pattern

### Changed
- `proc_build_push_deploy`, `proc_setup_custom_domain`, `proc_build_run_and_deploy` now accept `project_id_or_name` (name or UUID) instead of requiring a project UUID
- README procedures table updated with current parameter names and `poll_history` output notes
- README `build_container_image` response example updated to show `build_output` field

### Fixed
- nginx:alpine Dockerfiles: changed `sed 's/listen  80;...'` (exact spaces, silently fails) to `sed 's/listen[[:space:]]*80;...'` (POSIX, matches any whitespace) in both `examples/starwars-splash/Dockerfile` and `examples/developer-splash/Dockerfile`

## [1.0.0] - 2026-05-08

### Added
- Initial public release of `code-engine-mcp-server`.
- MCP server support for IBM Code Engine and Docker/Podman workflows.
- Core tools for projects, applications, builds, build runs, jobs, secrets, and config maps.


