# Tool reference

The server publishes **28 tools**: one tool per resource, plus a few standalone tools. A resource tool takes an `action` field (`list`, `get`, `create`, `delete`, …) and routes it to the original handler, so nothing was dropped when the catalog went from 112 tools to 28. The old names still answer, they are just not in `tools/list`.

Call `describe_server` first when you are unsure which tool to use. Call `get_schema` with a tool name to get the exact fields of each action.

- [At a glance](#at-a-glance)
- [How a call looks](#how-a-call-looks)
- [Reading the tables](#reading-the-tables)

## At a glance

| Tool | Kind | What it is for |
|---|---|---|
| [`describe_server`](#describe_server) | read-only | Discovery tool: server version, IBM Cloud API key status, supported CE regions, and the published tool catalog |
| [`list_schemas`](#list_schemas) | read-only | List every schema id: the data schemas (server, settings, log, error) and one per tool name |
| [`get_schema`](#get_schema) | read-only | Get one schema from list_schemas |
| [`local_container`](#local_container) | can delete or stop | Docker or Podman on this machine: detect the runtime, build, tag, push, run, inspect, and clean up images and containers |
| [`dockerfile`](#dockerfile) | writes | Check or create a Dockerfile for Code Engine (linux/amd64, port 8080, non-root) |
| [`icr`](#icr) | can delete or stop | IBM Container Registry: namespaces and the images in them |
| [`ce_project`](#ce_project) | can delete or stop | Code Engine projects |
| [`ce_app`](#ce_app) | can delete or stop | Code Engine applications (always-on or scale-to-zero HTTP services) |
| [`ce_app_inspect`](#ce_app_inspect) | read-only | Read-only diagnostics for one Code Engine app: running instances, logs, Kubernetes events (why it will not start), and revisions (what to roll back to) |
| [`ce_job`](#ce_job) | can delete or stop | Code Engine job definitions (batch work that runs to completion) |
| [`ce_job_run`](#ce_job_run) | can delete or stop | Runs of Code Engine jobs |
| [`ce_build`](#ce_build) | can delete or stop | Code Engine build configurations: build a container image in IBM Cloud from Git (no local Docker needed) |
| [`ce_build_run`](#ce_build_run) | writes | Runs of Code Engine builds |
| [`ce_secret`](#ce_secret) | can delete or stop | Code Engine secrets: generic key/value, registry pull credentials, TLS, SSH |
| [`ce_config_map`](#ce_config_map) | can delete or stop | Code Engine config maps: non-secret key/value settings for apps and jobs |
| [`ce_domain_mapping`](#ce_domain_mapping) | can delete or stop | Custom domains for Code Engine apps |
| [`ce_binding`](#ce_binding) | can delete or stop | Service bindings: connect an IBM Cloud service instance (through its service_access secret) to a Code Engine app or job |
| [`ce_function`](#ce_function) | can delete or stop | Code Engine serverless functions (code, not container images) |
| [`ce_fleet`](#ce_fleet) | can delete or stop | Code Engine fleets: large pools of workers that process a queue of tasks |
| [`proc_build_push_deploy`](#proc_build_push_deploy) | writes | PROCEDURE: Full container pipeline in one step — auto-detects Podman or Docker, builds for linux/amd64, pushes to IBM Container Registry (ICR), creates or updates a Code Engine application, waits for ready, and returns the public URL |
| [`proc_setup_custom_domain`](#proc_setup_custom_domain) | writes | PROCEDURE: Custom domain setup in one step — reads TLS certificate PEM files from disk (e.g |
| [`proc_apply_manifest`](#proc_apply_manifest) | writes | Apply a declarative JSON deployment manifest (ce-deploy.json) to Code Engine |
| [`write_or_modify_file`](#write_or_modify_file) | writes | Write or update a text file in the workspace |
| [`server_settings`](#server_settings) | writes | This MCP server's saved settings |
| [`server_access`](#server_access) | writes | Who and what can reach this MCP server |
| [`server_users`](#server_users) | can delete or stop | The people and programs that may call this server (admin scope) |
| [`server_api_keys`](#server_api_keys) | can delete or stop | MCP API keys for programs that call this server (admin scope) |
| [`server_log`](#server_log) | writes | This MCP server's own call log and outbound event subscription |

## How a call looks

Every tool is an ordinary MCP tool. With the server in HTTP mode, a call is a JSON-RPC `tools/call` posted to `/mcp`:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -u admin:admin \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"ce_app",
                 "arguments":{"action":"list","project_id":"<project-id>"}}}'
```

Read one app: the same tool with `"action":"get"` and one more field, `"app_name":"my-app"`.

`-u admin:admin` is the default of a server the VS Code extension starts on your own machine. A server on another host takes `-H 'Authorization: Bearer <MCP API key>'` or its own user and password. A stdio server takes the same JSON-RPC messages on stdin. See [Tool scope and authentication](TOOL_ACCESS.md).

A wrong call tells you what to fix, for example `ce_app action get is missing app_name.`, or `ce_app has no action "nope".` with the list of valid actions. Every successful result carries a `next` hint.

## Reading the tables

- **Needs** lists the fields an action requires besides `action`. Other fields are optional; `get_schema` lists them.
- **read-only** tools only look. **can delete or stop** means at least one of the actions removes or stops something, so ask the assistant to confirm before it runs those. **writes** creates or changes something.
- Permissions follow the action, not the bundle: `ce_app` with `list` needs read, with `delete` it needs write. See [Tool scope and authentication](TOOL_ACCESS.md).
- Project ids come from `ce_project` with `action: "list"`.

## Discovery

### `describe_server`

Discovery tool: server version, IBM Cloud API key status, supported CE regions, and the published tool catalog. Read-only.

Needs: nothing.

### `list_schemas`

List every schema id: the data schemas (server, settings, log, error) and one per tool name. Read-only.

Needs: nothing.

### `get_schema`

Get one schema from list_schemas. Read-only.

Needs: `name`.

## Local containers (Docker or Podman)

### `local_container`

Docker or Podman on this machine: detect the runtime, build, tag, push, run, inspect, and clean up images and containers. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `detect` | Report whether Docker or Podman is installed. | — |
| `build` | Build an image from a Dockerfile. | `dockerfile_path`, `image_name`, `context_path` |
| `images` | List local images. | — |
| `inspect` | Show architecture, ports, entrypoint, and env of one image. | `image_name` |
| `tag` | Give an image a new name, e.g. its full ICR path. | `source_image`, `target_image` |
| `push` | Push an image. For ICR, image_name is the full path like us.icr.io/<namespace>/<app>:<tag>; log in first. | `image_name` |
| `login` | Log in to a registry. For ICR only registry is needed; the server uses its IBM Cloud key. | `registry` |
| `run` | Run an image locally to test it. | `image_name` |
| `containers` | List running containers, or all with all=true. | — |
| `logs` | Show logs of a local container. | `container_id` |
| `stop` | Stop a local container; remove=true also deletes it. | `container_id` |
| `remove_image` | Delete a local image. | `image_name` |
| `prune` | Delete dangling images, or all unused images with all=true. | — |

### `dockerfile`

Check or create a Dockerfile for Code Engine (linux/amd64, port 8080, non-root).

| `action` | What it does | Needs |
|---|---|---|
| `validate` | List errors, warnings, and info for a Dockerfile. | `dockerfile_path` |
| `scaffold` | Generate a Dockerfile for a folder (static, Node.js, or Python). Writes it only when write=true. | `context_path` |

## IBM Container Registry

### `icr`

IBM Container Registry: namespaces and the images in them. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `namespaces` | List registry namespaces in the account. | — |
| `create_namespace` | Create a namespace. | `namespace` |
| `images` | List images, optionally in one namespace. | — |
| `delete_image` | Delete one image by tag or digest, e.g. us.icr.io/ns/app:v1. | `image` |

## Code Engine: projects and apps

### `ce_project`

Code Engine projects. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List projects in every region, or one region. | — |
| `get` | Get one project. | `project_id` |
| `status` | Show readiness and enabled components. | `project_id` |
| `quotas` | Show used vs limit for CPU, memory, instances, apps, secrets, and more. | `project_id` |
| `egress_ips` | List public egress IPs for firewall allowlists. | `project_id` |
| `create` | Create a project in a region. New projects take about a minute to become active. | `name`, `region` |
| `delete` | Delete a project and everything in it. | `project_id` |

### `ce_app`

Code Engine applications (always-on or scale-to-zero HTTP services). One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List apps in the project. | `project_id` |
| `get` | Get one app, including status and endpoint URL. | `project_id`, `app_name` |
| `create` | Create an app from a container image. | `project_id`, `app_name`, `image` |
| `update` | Change image, scaling, command, or arguments. Creates a new revision. | `project_id`, `app_name` |
| `wait_ready` | Poll until the app is ready or timeout_seconds passes. | `project_id`, `app_name` |
| `restart` | Restart running instances so they pick up the latest config. | `project_id`, `app_name` |
| `rollback` | Re-apply an earlier revision. Find revision_name with ce_app_inspect action revisions. | `project_id`, `app_name`, `revision_name` |
| `sync_env` | Apply a local .env file to the app (target=app) or to a generic secret (target=secret). | `project_id` |
| `find_idle` | List apps that never scale to zero (scale_min_instances > 0) and so cost money when idle. | `project_id` |
| `delete` | Delete an app. | `project_id`, `app_name` |

### `ce_app_inspect`

Read-only diagnostics for one Code Engine app: running instances, logs, Kubernetes events (why it will not start), and revisions (what to roll back to). Read-only.

| `action` | What it does | Needs |
|---|---|---|
| `instances` | List running instances, or one with instance_name. | `project_id`, `app_name` |
| `logs` | Get recent logs from all instances, or one with instance_name. | `project_id`, `app_name` |
| `events` | Get platform events such as ImagePullBackOff or CrashLoopBackOff (kept about 60 minutes). | `project_id`, `app_name` |
| `revisions` | List revisions, or one with revision_name. | `project_id`, `app_name` |

## Code Engine: jobs and builds

### `ce_job`

Code Engine job definitions (batch work that runs to completion). One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List job definitions. | `project_id` |
| `get` | Get one job definition. | `project_id`, `job_name` |
| `create` | Create a job from a container image. | `project_id`, `job_name`, `image` |
| `update` | Change image, scaling, array spec, or env. | `project_id`, `job_name` |
| `delete` | Delete a job definition. | `project_id`, `job_name` |

### `ce_job_run`

Runs of Code Engine jobs. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `submit` | Start a run of job_name; job_run_name optionally names the run. | `project_id`, `job_name` |
| `list` | List runs, optionally only for job_name. | `project_id` |
| `get` | Get status of one run. | `project_id`, `job_run_name` |
| `events` | Get platform events such as OOMKilled or image pull errors. | `project_id`, `job_run_name` |
| `resubmit` | Run job_run_name again with the same config; new_run_name optionally names the new run. | `project_id`, `job_run_name` |
| `cancel` | Stop and delete a run. | `project_id`, `job_run_name` |

### `ce_build`

Code Engine build configurations: build a container image in IBM Cloud from Git (no local Docker needed). One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List build configurations. | `project_id` |
| `get` | Get one build configuration. | `project_id`, `build_name` |
| `create` | Create a build. output_secret must be a registry secret with push access. | `project_id`, `build_name`, `output_image`, `output_secret`, `source_url` |
| `update` | Update source_url, source_revision, strategy_type, or output_image on an existing build. | `project_id`, `build_name` |
| `delete` | Delete a build configuration. | `project_id`, `build_name` |

### `ce_build_run`

Runs of Code Engine builds.

| `action` | What it does | Needs |
|---|---|---|
| `start` | Start a run of build_name; build_run_name optionally names the run. | `project_id`, `build_name` |
| `list` | List build runs. | `project_id` |
| `get` | Get status of one run: pending, running, succeeded, or failed. | `project_id`, `build_run_name` |
| `logs` | Get the build output (kept only briefly after it finishes). | `project_id`, `build_run_name` |
| `events` | Get platform events such as clone or push failures. | `project_id`, `build_run_name` |

## Code Engine: configuration

### `ce_secret`

Code Engine secrets: generic key/value, registry pull credentials, TLS, SSH. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List secrets (names and formats). | `project_id` |
| `get` | Get one secret: format and key names, not values. | `project_id`, `secret_name` |
| `create` | Create a secret; format is generic, registry, ssh_auth, basic_auth, tls, or service_access. | `project_id`, `secret_name`, `format`, `data` |
| `update` | Replace the data of a secret; keys not in data are removed. | `project_id`, `secret_name`, `data` |
| `create_tls` | Create (mode=create) or renew (mode=renew) a TLS secret from PEM files on disk. | `project_id`, `secret_name`, `cert_pem_path`, `key_pem_path` |
| `refresh_icr_pull` | Recreate the ICR pull secret with fresh credentials from the server key. | `project_id` |
| `delete` | Delete a secret. | `project_id`, `secret_name` |

### `ce_config_map`

Code Engine config maps: non-secret key/value settings for apps and jobs. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List config maps. | `project_id` |
| `get` | Get one config map with its data. | `project_id`, `config_map_name` |
| `create` | Create a config map from a data object. | `project_id`, `config_map_name`, `data` |
| `update` | Replace the data of a config map; keys not in data are removed. | `project_id`, `config_map_name`, `data` |
| `delete` | Delete a config map. | `project_id`, `config_map_name` |

### `ce_domain_mapping`

Custom domains for Code Engine apps. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List domain mappings. | `project_id` |
| `get` | Get one mapping and its CNAME target. | `project_id`, `domain_name` |
| `create` | Map domain_name to app_name using tls_secret. | `project_id`, `domain_name`, `app_name`, `tls_secret` |
| `update` | Point the domain at another app or TLS secret. | `project_id`, `domain_name` |
| `delete` | Delete a domain mapping. | `project_id`, `domain_name` |

### `ce_binding`

Service bindings: connect an IBM Cloud service instance (through its service_access secret) to a Code Engine app or job. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List bindings. | `project_id` |
| `get` | Get one binding. | `project_id`, `binding_id` |
| `create` | Bind secret_name to a component (component_resource_type app_v2 or job_v2). | `project_id`, `component_name`, `component_resource_type`, `secret_name` |
| `delete` | Delete a binding. | `project_id`, `binding_id` |

## Code Engine: functions and fleets

### `ce_function`

Code Engine serverless functions (code, not container images). One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `runtimes` | List available runtimes (no project needed). | — |
| `list` | List functions. | `project_id` |
| `get` | Get one function, including its URL. | `project_id`, `function_name` |
| `create` | Create a function from code_reference (inline data: URL or a registry image). | `project_id`, `function_name`, `runtime`, `code_reference` |
| `update` | Change code, runtime, scaling, or env. | `project_id`, `function_name` |
| `delete` | Delete a function. | `project_id`, `function_name` |

### `ce_fleet`

Code Engine fleets: large pools of workers that process a queue of tasks. One or more actions delete or stop something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List fleets. | `project_id` |
| `get` | Get one fleet. | `project_id`, `fleet_id` |
| `create` | Create a fleet from an image; name is the new fleet name. | `project_id`, `name`, `image` |
| `add_tasks` | Queue tasks on a fleet. | `project_id`, `fleet_id`, `tasks` |
| `tasks` | List tasks, or one with task_id. | `project_id`, `fleet_id` |
| `workers` | List workers, or one with worker_name. | `project_id`, `fleet_id` |
| `cancel` | Cancel a running fleet. | `project_id`, `fleet_id` |
| `delete` | Delete a fleet. | `project_id`, `fleet_id` |

## Procedures (multi-step workflows)

### `proc_build_push_deploy`

PROCEDURE: Full container pipeline in one step — auto-detects Podman or Docker, builds for linux/amd64, pushes to IBM Container Registry (ICR), creates or updates a Code Engine application, waits for ready, and returns the public URL.

Needs: `context_path`, `project_id_or_name`, `app_name`, `image_secret`, `icr_namespace`.

### `proc_setup_custom_domain`

PROCEDURE: Custom domain setup in one step — reads TLS certificate PEM files from disk (e.g.

Needs: `project_id_or_name`, `app_name`, `domain_name`, `tls_secret_name`, `cert_pem_path`, `key_pem_path`.

### `proc_apply_manifest`

Apply a declarative JSON deployment manifest (ce-deploy.json) to Code Engine.

Needs: nothing.

## Workspace

### `write_or_modify_file`

Write or update a text file in the workspace.

Needs: `path`, `content`.

## This server: settings, access, users, keys, log

### `server_settings`

This MCP server's saved settings.

| `action` | What it does | Needs |
|---|---|---|
| `get` | Read version, region, activity log, auth mode, protocols, rate limit, audit, and page lock. | — |
| `update` | Change region and/or activity_enabled. | — |
| `secrets` | Admin. Set the Code Engine IBM Cloud API key (ibmcloud_api_key or code_engine_api_key) and/or admin_password. Omit a field to keep it. The key is never returned. | — |
| `export` | Admin. Return the settings document (no passwords or keys). | — |
| `import` | Admin. Restore a document from export. | `document` |

### `server_access`

Who and what can reach this MCP server.

| `action` | What it does | Needs |
|---|---|---|
| `auth_mode` | Set mode: open, writes, or all. | `mode` |
| `tool_gate` | Enable or disable one tool (a bundle name disables every action). | `tool_name`, `enabled` |
| `tool_scope` | Set scope to read-only, write, destructive, or default. | `tool_name`, `scope` |
| `tool_lock` | Lock one tool so it needs the admin scope, or unlock it. | `tool_name`, `locked` |
| `rate_limit` | Set enabled, limit, and windowSeconds per caller. | `enabled` |
| `protocols` | Turn stdio, streamableHttp, and sse on or off (pass all three). | `stdio`, `streamableHttp`, `sse` |
| `audit` | Turn the audit trace on or off. Pass enabled true or false. Not admin: open mode needs no key. | `enabled` |
| `ui_auth` | Hide the dashboard pages until an admin signs in. | `enabled` |

### `server_users`

Admin scope only. The people and programs that may call this server. These are not IBM Cloud users. One or more actions delete something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List usernames and scopes. | — |
| `create` | Create a user with scopes read, write, and/or admin. | `username`, `password`, `scopes` |
| `update` | Change a password, scopes, or both. Omit a field to keep it. | `username` |
| `delete` | Delete a user. | `username` |

### `server_api_keys`

Admin scope only. MCP API keys (they start with `cemcp_`) for programs that call this server. The secret is shown once, when it is issued. One or more actions revoke something.

| `action` | What it does | Needs |
|---|---|---|
| `list` | List keys: id, prefix, label, scopes, active. | — |
| `issue` | Issue a key with a label and scopes. | `label`, `scopes` |
| `revoke` | Revoke a key by id. | `id` |

### `server_log`

This MCP server's own call log and outbound event subscription.

| `action` | What it does | Needs |
|---|---|---|
| `trace` | Read recent audit-trace rows. Not admin. | — |
| `activity` | Admin. Read recent activity-file rows. | — |
| `export` | Admin. Return counters, recent errors, and the trace. | — |
| `generate_traffic` | Make rounds of safe read calls. | — |
| `events` | Read the event subscription. The MQTT password is not returned. | — |
| `configure` | Admin. Set realtime or a 5-minute interval, Allow push_log, and MQTT. Omit mqtt_password to keep it. | — |
| `push` | Send one line now when Allow push_log is on. | `line` |
