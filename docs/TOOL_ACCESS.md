# Tool scope and authentication

This page explains the labels on the dashboard **Tools** page. Scope describes how a tool behaves. Authentication decides who is allowed to call it. Changing either one requires an admin sign-in.

## Two kinds of credential

- **IBM Cloud API key** (`IBMCLOUD_API_KEY`) is the credential for IBM Cloud. Every Code Engine and registry call uses this one key for the whole server process. The browser never sees it.
- **MCP caller credentials** decide who may call a tool on this server. They are never sent to IBM Cloud. There are three kinds:
  - the dashboard admin session (sign in at `/admin` with `ADMIN_PASSWORD`),
  - a user (`server_users` action `create`), sent as `Authorization: Basic user:password`,
  - an API key (`server_api_keys` action `issue`; it starts with `cemcp_`), sent as `Authorization: Bearer <secret>`.

  Over stdio there are no headers, so set `MCP_API_KEY`, or `MCP_USERNAME` and `MCP_PASSWORD`, in the MCP server environment.

Each caller credential has scopes: `read`, `write`, or `admin`. `admin` includes write and read; `write` includes read. The built-in admin is `ADMIN_USER` (default `admin`) with `ADMIN_PASSWORD`. On a public bind (`HOST=0.0.0.0` or a container) the built-in admin is refused until `ADMIN_PASSWORD` is set.

A tool can have a valid IBM Cloud key and still be refused because the caller lacks a scope.

## Operating tools

The server publishes 28 tools; most of them take an `action` (see the [tool reference](TOOLS.md)). Scope and authentication are decided **per action**, not per tool: `ce_app` with `list` is read-only, `ce_app` with `delete` is destructive. The old single-purpose names (`ce_list_applications`, `create_user`, …) follow the same rules because a bundle call is checked against the handler it routes to.

Admin actions always need the `admin` scope, in every auth mode. They are:

- `server_access`: every action except `audit` (modes, tool gate, scope and lock, rate limit, protocols, page lock),
- `server_users` and `server_api_keys`: all actions,
- `server_settings`: `secrets`, `export`, `import`,
- `server_log`: `activity`, `export`, `configure`.

`server_log` with `generate_traffic` needs any credential. `server_log` with `trace` and `push`, `server_access` with `audit`, and `server_settings` with `get` are not admin. `list_schemas`, `get_schema` and `server_settings` `get` are read-only, and `server_settings` `update` is a write action. It only changes the default region and activity logging.

`describe_server` is always open. It cannot be locked or disabled, and it reports your principal, your scopes, and what every tool `requires` right now.

## What scope means

Scope does not change the IBM Cloud call. `ce_project` with `delete` still deletes a project if you relabel it. Scope only records how dangerous the call is, and whether **Protect writes** asks for an admin session first.

- **read-only** — the tool only looks. Examples: `ce_project` with `list`, `ce_app` with `get`, `describe_server`.
- **write** — the tool creates or updates something. Examples: `ce_app` with `create`, `ce_job` with `update`, `proc_build_push_deploy`.
- **destructive** — the tool removes or stops something. That is every `delete` action, plus actions that stop work: for example `icr` `delete_image`, `local_container` `prune`, `stop` and `remove_image`, `ce_job_run` `cancel`, and `ce_fleet` `cancel`.

The **Try** button asks for confirmation before it runs a destructive tool.

**Default** on the scope menu means “use the label inferred from the tool name.” Pick read-only, write, or destructive only when you want **Protect writes** to treat that tool differently.

## Who can call a tool

The **Who can call tools** setting on the Tools page applies to every tool:

- **Open** (`open`) — calls are allowed. Admin actions, `server_log` `generate_traffic`, and tools set to **needs admin** are the exception.
- **Protect writes** (`writes`) — read-only tools stay open. Write and destructive tools need the `write` scope.
- **Lock all tools** (`all`) — read-only tools need the `read` scope and the rest need `write`. `describe_server` stays open so a client can still discover the server.

An admin can also switch the mode with `server_access` action `auth_mode`, lock one tool with `tool_lock`, or turn one tool off with `tool_gate` (a bundle name turns off every action of it).

The **Authentication** column is the per-tool override:

- **open** — follow the setting above.
- **needs admin** — this tool requires a signed-in admin even when the mode is Open.

**Right now** shows the result: **open**, or **admin session**.

Saving scope or authentication without a sign-in is refused. After you sign in, **Try** can call a protected tool because the browser sends the admin cookie. A curl command or an IDE chat session does not send that cookie. Give it a Basic or Bearer credential, or `MCP_API_KEY` over stdio.

## Where this is stored

The dashboard writes `~/.code-engine-mcp/tool-policy.json` (mode `0600`). This HTTP server reads it on the next call. An IDE MCP process is separate: it enforces the file only when it is running this same server build.

Users and API keys are in `~/.code-engine-mcp/user-store.json` (mode `0600`). Passwords are salted scrypt hashes, and only a SHA-256 digest of each key secret is kept. Protocol switches, rate limit, audit, and the page lock are held in memory. They start from `RATE_LIMIT_ENABLED` (default on, 60 calls per 60 seconds per caller), `RATE_LIMIT`, `RATE_LIMIT_WINDOW_SECONDS`, `AUDIT_ENABLED`, and `UI_AUTH_ENABLED`.

## Export and import

Admin only. Both work from the browser while you are signed in.

- **Settings**: `/admin` → Overview → *Export and import settings*. The file holds region, activity logging, tool scope and locks, authentication mode, protocols, and the rate limit. It never holds the IBM Cloud API key, the admin password, users, or MCP API keys. Import checks the file (`kind` must be `settings`, the region must be a Code Engine region) and applies it at once.
- **Logs**: `/log` → each tab has CSV and JSON buttons (`/log/export?view=trace|errors|counters&format=csv|json`). In CSV, a cell that starts with `=`, `+`, `-` or `@` gets a leading quote so a spreadsheet does not run it as a formula.
- Click a column header on the log tables to sort. Click again to reverse.
