# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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


