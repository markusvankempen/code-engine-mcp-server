# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation
- **New [`docs/TOOLS.md`](docs/TOOLS.md)**: reference for the 28 published tools with every `action`, its required fields and a curl example (generated from the live `get_schema` output).
- **README** brought up to v1.7.8: 28-tool catalog, shared HTTP server and transport guidance, web admin UI with the Remote client tab, MCP Remote Config, current security model (`MCP_LOCAL_ONLY`, default local `admin` / `admin`), Path C rewritten for the shared server, full list of environment variables.
- **`docs/TOOL_ACCESS.md`** uses the bundle names (`server_users`, `server_api_keys`, `server_access`, `server_settings`, `server_log`) and lists which actions need the admin scope.
- **`docs/MCP_INSPECTOR_TROUBLESHOOTING.md`** and **`docs/CLIENT_README.md`** point out the 28-tool list and the older names.

## [1.7.8] - 2026-10-01

### Fixed
- **Admin page, Remote client: the Logging, Users & API keys and Events sub-tabs did nothing** and the page stayed on Test tools. The four sub-panels were missing the class the tab switcher looks for. A test now checks that every sub-tab has its panel and that exactly one starts open.

## [1.7.7] - 2026-10-01

### Changed
- **VS Code: the local server uses `admin` / `admin` by default.** New setting `codeEngineMcp.localAdminPassword` (default `admin`). Set a longer value, or leave it empty to get the previous behaviour, a generated password kept in SecretStorage (*Copy admin password* in the sidebar). Changing it restarts the server the extension owns and offers to update the IDE config files, because they carry the login. The sidebar now says how to sign in.

### Security
- **`MCP_LOCAL_ONLY=true`** makes the HTTP server answer only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]` and refuse everything else with 403. The extension sets it for the server it starts, so a web page that rebinds its own name to `127.0.0.1` cannot reach a server that holds your IBM Cloud key, even with a well-known password. Off by default, so servers behind a reverse proxy are unaffected. Covered by `__tests__/local-only.test.ts`.

## [1.7.6] - 2026-10-01

### Fixed
- **`ce_fleet` was rejected by VS Code chat** ("tool parameters array type must have items"). The `tasks` field of the fleet tool was an array with no `items`. It now declares object items. A new test walks every published input and output schema and fails if any array lacks `items`, because strict clients refuse the whole tool for one such field.

## [1.7.5] - 2026-10-01

### Added
- **VS Code: choose how the local server runs, default one shared HTTP server.** New setting `codeEngineMcp.localTransport` (Setup → Server connection → This computer): *Shared HTTP server* (default) or *stdio*. In HTTP mode the extension starts one server on `127.0.0.1` (port `codeEngineMcp.localHttpPort`) with a generated admin login, reuses one that is already running, and restarts it when the IBM Cloud key, region or logging setting changes. If the window that owns it closes, another open window starts it again within 30 seconds. Chat, the IDE MCP list, the `/admin` web UI and MCP Remote Config all use that one process, so the audit trace, logging, users, keys and settings line up. stdio keeps one private process per IDE.
- **Configure MCP follows the transport.** In HTTP mode it writes `{ type: "http", url: "http://127.0.0.1:<port>/mcp", headers: { Authorization } }` (or each IDE's equivalent) under the `code-engine` id, replacing a stdio entry in place and the other way round, so there is never a stdio copy next to an HTTP one. Changing the transport or port offers to update the files; the sidebar warns when `mcp.json` no longer matches.
- **Diagnostics** lists the tools of the shared server itself in HTTP mode, and the *Discovered Tools* heading now shows how many were found, for example `Discovered Tools (28)`.

### Changed
- Activity logging for the shared server is controlled by the extension (`codeEngineMcp.activityEnabled`) and restarts the server it owns; the *Configure Activity Logging* command no longer edits `env` on an HTTP entry.

## [1.7.4] - 2026-10-01

### Fixed
- **VS Code: *Configure MCP* wrote `npx code-engine-mcp-server@latest` into `mcp.json` even when the extension ran its bundled server**, so the IDE's MCP list and the extension could run different versions (for example 89 old tools in one, 28 in the other). It now writes the same command the extension runs: the bundled server, a newer cached npm build, or npx when *Install method* is `npx`. Run *Configure MCP* again after changing the install method or updating the extension (the bundled path contains the extension version).

### Changed
- **Admin page: the *Remote config client* tab is now *Remote client*.** It says what it is for (testing this server's MCP tools as an MCP client does) and now has the remote configuration the browser client had, in four sub-tabs: *Test tools*, *Logging* (activity log on/off, audit trace on/off and a trace view), *Users & API keys* (list/create/update/delete users, create/list/revoke MCP API keys, secret shown once) and *Events* (listen over Streamable HTTP or legacy SSE, send a test line). The Audit trace card moved from the Activity tab into *Logging*.
- **VS Code: MCP Remote Config follows Setup → Server connection.** The address field is read-only and says whether it is *This computer* or *Remote server*. When you save a different connection (or change the remote URL, saved credential or local port) while the panel is open, the panel switches to it and reloads its tools instead of staying on the old one. The sidebar tab shows the same target and refreshes after saving Setup.

## [1.7.3] - 2026-10-01

### Added
- **VS Code: check that the server is a code-engine MCP server.** The extension now asks the server what it is (the `service` on `/health`, the name in the MCP initialize reply, and whether it offers `describe_server`). If it is something else, Test connection and Diagnostics say so and name what it claims to be; saving the connection and *Configure MCP* are refused; chat does not register it (you get one warning); MCP Remote Config does not open on it, and if you type another URL into the panel it shows a red banner and blocks the forms until you choose *Use anyway*. The local HTTP server start also refuses a port that another program already answers on.

## [1.7.2] - 2026-10-01

### Fixed
- **Remote config client stuck on "Loading tools…"** on the Admin page. Its script ran before the Audit trace card existed and stopped. It now waits for the page.
- **Unstyled text inputs** (the Admin sign-in username, labels, MQTT fields). Inputs without `type="text"` now get the same style as the others.

### Changed
- The Admin page's *Tool console* tab is now called *Remote config client*.

## [1.7.1] - 2026-10-01

### Added
- **HTTP dashboard: Remote config client and Audit trace on the Admin page.** The browser client's main features now live inside `/admin`: pick a tool, fill a schema-driven form (with a project picker), call it, and read the result, request and response, using the admin sign-in (no URL or key to enter). The Activity tab adds the audit trace toggle and the recent trace. Actions that change or delete resources ask for confirmation first.
- **VS Code: MCP Remote Config.** A native panel (sidebar *Remote Config* tab, command *Open MCP Remote Config*) to run any tool, change logging, manage users and MCP API keys, and watch live events, in the VS Code theme. Requests go through the extension, which only reaches this machine and the saved remote server and adds the credential itself, so the page never sees it. The tab can also start and stop the bundled server in HTTP mode on `127.0.0.1` (setting `codeEngineMcp.localHttpPort`, default 8787) with a generated admin password, and open the web dashboard.
- **Bundle sync check.** A test fails when the server bundled in the extension differs from the compiled build, when versions disagree, or when a needed package is missing from the bundle.

## [1.7.0] - 2026-10-01

### Added
- **Host-neutral remote servers.** Test connection explains HTTP 404 (stopped or wrong path) and 502/503 (host up, server down); docs list other hosts (Render, Fly.io, a VM). Demo URLs with a personal subdomain were replaced by placeholders.
- **VS Code sidebar: MCP server version.** Setup & Diagnostics shows the extension, local server, and newest npm versions, says whether an update exists (or whether the local build is newer than npm), and can pull the update.
- **VS Code sidebar: remote server.** Choose *This computer* or *Remote server*. Enter a URL and an optional credential (kept in SecretStorage), test it (version, tool count, auth mode), and chat uses it. **Configure MCP** writes a `code-engine-remote` entry into each IDE. New settings `codeEngineMcp.serverMode` and `codeEngineMcp.remoteUrl`.
- **Log page and settings.** Sortable log columns, CSV/JSON log export, and settings export/import (no secrets) on the HTTP dashboard.

### Security
- Standalone `npm run dashboard` server binds to 127.0.0.1, checks Host and Origin, requires JSON for actions, and no longer crashes on a malformed URL.
- Activity log scrubs secrets from free text (Bearer tokens, JWTs, `key=value`, URL passwords, private keys); the log file is written `0600`.
- Activity dashboard page escapes quotes, opens only `http(s)` links, and the extension webview runs under a nonce-only Content-Security-Policy.

## [1.6.1] - 2025-12-01

### Added
- **`ce_update_build`** — new tool (and `ce_build` bundle `update` action) to PATCH an existing Code Engine build configuration.
- **`openWorldHint` annotations** — every published tool now has a correct `openWorldHint` (`true` for IBM Cloud / external-network tools, `false` for local server-state tools). Fixed `annotationsFor()` in `tool-policy.ts` to read inferred annotations rather than always returning `true`.
- **Deprecation warnings** — direct calls to legacy (unbundled) tool names now receive a deprecation hint in the response pointing to the equivalent bundle action.
- **Browser-local timestamps** on the Log page (`<time data-ts>` elements, formatted client-side).
- **`authMode` and `rateLimit` fields** on the `/health` JSON response and the health page stats.
- **`mise run build`** now also syncs `build/index.js` and `build/index.js.map` to `vscode-extension/server/` automatically.

### Changed
- **Dashboard CSS** — aligned with the reference UI: `.page-tabs`/`.page-tab` replace `.tabs`/`.tab` on all pages; `.tbl-wrap` wraps every table; `.tag` replaces `.badge` for scope labels; `.eyebrow` + `h2.page-title` pattern used on every page heading; `.help-icon`/`.help-drawer` pattern for contextual help.
- **`pageHeading()` helper** — `line2` parameter is now optional (defaults to `''`).
- **Log page** — eyebrow heading, `.page-tabs`, `.tbl-wrap` on all three tables; stat containers use `.stat.ok`/`.stat.warn` classes.
- **Help page** — eyebrow heading, `.page-tabs`, all tables wrapped in `.tbl-wrap`, `.badge` → `.tag` on scope labels.
- **`MAX_PUBLIC_TOOLS`** reduced from 40 to 35.
- **Admin login page** — password hint clarifies the default is disabled on public binds.
- **Footer and About card** — removed email address to comply with IBM security policy.
- **`curlBlock()`** — uses `data-copy` attribute so HTML entity encoding in the clipboard is not corrupted.
- **`showPane()`** — handles both `.page-tab[data-target]` and legacy `.tab[data-pane]` patterns.
- **`submitTry()`** — opens the result in a new browser tab.
- **Log auto-refresh** — polls `/log?format=json` every 5 s and reloads the page if the event total increases.
- **Health page** — `cwd` displayed as a full-width `.cwd-field` read-only input; new `authMode` and `rateLimit` stat tiles.

### Fixed
- `tool-policy.ts`: `annotationsFor()` was always setting `openWorldHint: true`; now delegates to `inferToolAnnotations()`.

## [1.6.0] - 2026-09-25

### Added
- **Functions and fleets** — `ce_list_function_runtimes`, function CRUD, fleet lifecycle, `ce_add_fleet_tasks`, fleet tasks and workers. List tools accept an optional name and return that one item.
- **`describe_server`** — reports version, API key presence, regions, and the published tool list.
- **Region `eu-es`** in project discovery.
- **Extension IDE configs** — Configure MCP writes the `code-engine` stdio entry for VS Code, Cursor, Bob, Windsurf, Cline, Antigravity, and Claude Desktop without removing other servers. Unparseable files are left unchanged.
- **npm update check** in the extension (`codeEngineMcp.checkNpmUpdates`). Pulls a newer `code-engine-mcp-server` into extension storage when one is published.
- **`mise run test-extension`** and IDE-config tests. `mise run test-all` includes them.

### Changed
- **Published tool list is 91** and tests fail if it reaches 99. Older get/renew names and some local image tools remain callable but are omitted from `tools/list`.
- Successful tool results also carry `structuredContent`; errors return `ok: false` with a `next` hint.
- **Activity logging is on by default** and writes to `~/.code-engine-mcp/activity/events.jsonl` (rotates at 5 MB). Set `MCP_ACTIVITY_ENABLED=false`, or turn off `codeEngineMcp.activityEnabled` in the extension. Redaction now covers env var values, secret payloads, TLS keys, and key-like fields in both inputs and results.
- **Extension** — MCP Activity Dashboard command and sidebar view work. Resource tree shows errors, missing-key, and empty states instead of a blank view. Sidebar doc buttons open bundled docs (GitHub fallback).
- **TLS renewal** is `ce_create_tls_secret_from_pem` with `mode: renew`. `ce_renew_tls_secret_from_pem` still works.
- **Tool annotations** (`readOnlyHint`, `destructiveHint`, `openWorldHint`) on every published tool.
- Restored `src/validators.ts` so a fresh clone builds.
- READMEs, setup docs, the deploy skill, and example guides match the 1.6.0 tool list and the multi-IDE Configure MCP writer. `run-client.sh` loads `.env` from the repo root.

## [1.5.0] - 2026-07-04

### Added
- **Code Engine Resource Tree** — a native VS Code tree in the IBM Code Engine sidebar that lists your projects and, under each, its applications, jobs, builds, secrets, and config maps. Apps show a live status dot (green = ready, yellow = pending) and open in the browser on click.
  - Inline / context-menu actions: **App** (Open in Browser, View Logs, View Events, Restart, Delete); **Build** (View Build, Delete); **Job / Secret / Config Map** (Delete).
  - Title-bar **Refresh** button re-loads the whole tree; the tree also auto-refreshes when the API key changes.
- **Activity sidebar view** — the MCP Activity Dashboard is now available as a persistent webview in the sidebar (in addition to the Command Palette panel).
- **"Code Engine Resource Tree" launcher** — a button in Setup & Diagnostics and a Quick Menu entry that reveal/focus the tree view.

### Changed
- **Tree data loading** — projects and per-project resources load in the background with a cache-first pattern (spinner while loading, clear error/empty states), so the tree renders instantly instead of blocking on server spawns.
- **Bundled extension server** — refreshed to 1.5.0 with all 89 tools, including the Batch D operational tools (`ce_get_app_events`, `ce_get_build_run_events`, `ce_get_job_run_events`, `ce_get_build_run_logs`, `ce_restart_application`, `ce_resubmit_job_run`, `ce_cancel_job_run`, `ce_get_project_quotas`).
- **Documentation** — current-release badges and readme callouts updated to v1.5.0 across main README and extension README.

## [1.4.2] - 2026-07-02

### Fixed
- **Extension readme GitHub links** — absolute `main` branch URLs for provenance addon and changelog (Marketplace was resolving relative paths to 404s like `/tree/provenance-addon`).
- **Extension VSIX readme** — packaged readme matches release version and feature list.

### Changed
- **Documentation** — current-release badges and readme callouts updated to v1.4.2.

## [1.4.1] - 2026-07-02

### Fixed
- **Extension VSIX readme** — rebuilt package so marketplace readme matches v1.4.1 (was stale v1.3.0 text in the 1.4.0 VSIX).
- **Extension readme GitHub links** — replaced relative paths (`../provenance-addon/`, `../../CHANGELOG.md`) with absolute `main` branch URLs; Marketplace was resolving them to 404s like `/tree/provenance-addon`.
- **`.env` parsing** — document and enforce quoted values for `MCP_ACTIVITY_CHAT_LABEL` and other labels with spaces (fixes `mise` dotenv errors).

### Changed
- **Documentation** — current-release badges and readme callouts updated to v1.4.1 across main README, extension README, examples, and workspace hub.

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
- **Documentation** — README, extension README, setup guide, example walkthroughs, and deploy skill updated for v1.4.0 Activity Dashboard.

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


