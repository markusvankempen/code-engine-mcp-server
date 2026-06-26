# Self-Hosting: Deploy the Code Engine MCP Server to Code Engine

> **Dogfooding** — use the `code-engine-mcp-server` running locally to deploy a copy of itself to IBM Code Engine, so any IDE or team member can reach it over HTTPS without running anything locally.

---

## How it works

```
Your IDE  ──(STDIO)──►  code-engine-mcp-server (local, npx)
                                 │
                         proc_build_push_deploy
                                 │
                   ┌─────────────▼─────────────────────────────┐
                   │  IBM Code Engine Application               │
                   │                                            │
                   │  Dockerfile (this example)                 │
                   │   └─ node:20-slim                          │
                   │       └─ code-engine-mcp-server (npm)      │
                   │           wrapped by bridge.mjs            │
                   │               │  HTTP + SSE                │
                   │               ▼                            │
                   │  https://<app>.<region>.codeengine…/sse    │
                   └────────────────────────────────────────────┘
                                 │
                   Any IDE  ──(SSE)──► remote MCP session
```

### Why no supergateway?

`supergateway` is a general-purpose stdio→SSE bridge. This example ships a purpose-built **`bridge.mjs`** (~130 lines of Node.js built-ins) that does the same job with zero extra npm dependencies. It:

- Spawns one `code-engine-mcp-server` process per SSE connection
- Extracts the IBM Cloud API key from the `Authorization` header per-connection (stateless — no key stored on the server)
- Validates JSON before forwarding to prevent malformed input
- Uses cryptographically random session IDs (`randomUUID()`)
- Responds to `/health` for Code Engine liveness probes

---

## Your deployment URL

After deploying, your application will be available at:

```
https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud
```

Code Engine assigns the `<subdomain>` automatically when the project is created — it never changes for a given project. Replace `<app-name>` with the name you chose (default: `ce-mcp-remote`) and `<region>` with your target region (e.g. `ca-tor`, `us-south`, `eu-de`).

| | |
|---|---|
| **Health** | `curl https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud/health` → `{"status":"ok"}` |
| **Dashboard** | `https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud/` |
| **SSE endpoint** | `https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud/sse` |
| **Tool stats** | `https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud/stats` |

> **Tip** — run `ibmcloud ce project get --name <project>` or ask your AI assistant `"Get the details of my Code Engine project <project>"` to find the subdomain for your project.

Add the SSE URL to your IDE MCP config — see [Configure your IDE](#configure-your-ide) below.

---

## What's in this directory

| File | Purpose |
|------|---------|
| `bridge.mjs` | Minimal HTTP+SSE bridge — no supergateway needed |
| `Dockerfile` | Multi-stage image: builds from `src/`, runs `bridge.mjs` |
| `.dockerignore` | Standard build exclusions |
| `deploy.mjs` | **Automated deploy script** — calls MCP tools via JSON-RPC, no CLI needed |
| `deploy-ibmcloud.sh` | Deploy script using the `ibmcloud` CLI |
| `deploy-api.sh` | Deploy script using IBM Cloud REST APIs directly (no CLI needed) |
| `mcp-client.json` | IDE config — pre-filled with live URL and auth headers |
| `README.md` | This guide |

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **IBM Cloud API key** | With `Code Engine Operator` + `Container Registry Writer` roles — [cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys) |
| **Code Engine project** | Existing or create one via `ce_create_project` / `ibmcloud ce project create` |
| **ICR namespace** | Existing or create one at [cloud.ibm.com/registry/namespaces](https://cloud.ibm.com/registry/namespaces) |
| **Docker or Podman** | For building the container image locally |
| **code-engine-mcp-server** _(Option A only)_ | `npx -y code-engine-mcp-server@latest` or via VS Code extension |

---

## Option A — AI / MCP tools (recommended)

> **Requirement** — the **local** `code-engine-mcp-server` must be active in your IDE.
> Tools are available via `npx -y code-engine-mcp-server@latest` (stdio) or the VS Code extension.
> Tool names are prefixed `mcp_code-engine_` in VS Code / GitHub Copilot.

### Copy-paste prompt for your AI assistant

Replace the values in `< >` with your own, then paste this entire block into your chat:

---

> Using **only the local code-engine MCP tools** (the tools provided by the locally-running `code-engine-mcp-server` — do NOT use any remote or cloud-hosted tool variant), deploy the Code Engine MCP server bridge to IBM Code Engine by calling the `proc_build_push_deploy` tool with these exact parameters:
>
> - **`context_path`** — absolute path to the example directory, e.g. `/Users/<you>/projects/code-engine-mcp-server/examples/deploy-mcp-server-to-code-engine`
> - **`project_id_or_name`** — your Code Engine project name or ID, e.g. `<your-project-name>`
> - **`app_name`** — `ce-mcp-remote` (or your preferred name)
> - **`icr_namespace`** — your ICR namespace, e.g. `<your-icr-namespace>`
> - **`icr_host`** — `us.icr.io` (or the ICR host for your region)
> - **`image_secret`** — `icr-pull-secret`
> - **`image_tag`** — `latest`
> - **`port`** — `8080`
> - **`scale_min_instances`** — `1` (keeps one instance always warm so in-memory tool stats persist; use `0` to scale to zero when idle)
> - **`scale_max_instances`** — `10`
> - **`env_vars`** — `{ "IBMCLOUD_REGION": "<your-region>" }` — for example `{ "IBMCLOUD_REGION": "us-south" }`
>
> **Important:** Do NOT include `IBMCLOUD_API_KEY` in `env_vars`. This server is stateless — `bridge.mjs` reads the API key from the `Authorization` header on each SSE connection. Adding it as an env var would expose the key to anyone who can read the app configuration.
>
> After deployment completes, return the full public HTTPS URL of the deployed application.

---

This triggers **`proc_build_push_deploy`** — a single MCP tool that runs the full pipeline:

```
Step 1  detect_container_runtime   → finds Docker or Podman
Step 2  build_container_image      → builds for linux/amd64
Step 3  login_to_registry          → authenticates to us.icr.io
Step 4  push_container_image       → pushes to ICR
Step 4.5 ce_refresh_icr_pull_secret → refreshes the pull secret token
Step 5  ce_create_application      → deploys to Code Engine
         (or ce_update_application if the app already exists)
Step 6  ce_wait_for_app_ready      → polls until status = "ready"
         → returns the public HTTPS URL
```

**Example tool call (what the assistant sends):**

```json
{
  "tool": "proc_build_push_deploy",
  "arguments": {
    "context_path": "<absolute-path>/examples/deploy-mcp-server-to-code-engine",
    "project_id_or_name": "<your-project-name-or-id>",
    "app_name": "ce-mcp-remote",
    "image_secret": "icr-pull-secret",
    "icr_namespace": "<your-icr-namespace>",
    "image_tag": "latest",
    "icr_host": "us.icr.io",
    "port": 8080,
    "scale_min_instances": 0,
    "scale_max_instances": 10,
    "env_vars": {
      "IBMCLOUD_REGION": "us-south"
    }
  }
}
```

> **Stateless design** — `IBMCLOUD_API_KEY` is intentionally NOT set as a Code Engine env var. `bridge.mjs` reads it from the `Authorization` header on each SSE connection. Set `scale_min_instances: 1` to keep an instance always warm (avoids ~5–10 s cold start).

**Expected response:**

```json
{
  "success": true,
  "app_name": "ce-mcp-remote",
  "status": "ready",
  "endpoint": "https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud",
  "image": "us.icr.io/<your-icr-namespace>/ce-mcp-remote:latest",
  "build_output": "..."
}
```

**Your SSE endpoint:**  
`https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud/sse`

---

## Option A — Step-by-Step (manual local MCP tool calls)

> These prompts use the **local code-engine MCP tools** only — the same tools available via `code-engine-mcp-server` running locally (tool prefix: `mcp_code-engine_` in VS Code / GitHub Copilot).

Use these prompts in sequence if you want full control over each stage.

### Step 1 — Find your project

> "List all my Code Engine projects"

Calls **`ce_list_projects`** — returns project IDs and regions.

```json
{ "tool": "ce_list_projects" }
```

Response excerpt:
```json
{
  "projects": [
    { "id": "abc12345-...", "name": "my-ce-project", "region": "us-south", "status": "active" }
  ]
}
```

### Step 2 — Create the ICR pull secret (if not already done)

> "Create a registry pull secret named `icr-pull-secret` in project `<project-id>` for ICR region `us.icr.io` using my API key"

Calls **`ce_create_secret`**:

```json
{
  "tool": "ce_create_secret",
  "arguments": {
    "project_id": "<project-id>",
    "name": "icr-pull-secret",
    "format": "registry",
    "data": {
      "username": "iamapikey",
      "password": "<your-ibm-cloud-api-key>",
      "server": "us.icr.io",
      "email": "unused@example.com"
    }
  }
}
```

### Step 3 — Build and push the image

> "Build the container image in the `deploy-mcp-server-to-code-engine` directory (use the absolute path) and push it to ICR namespace `<your-icr-namespace>` as `ce-mcp-remote:latest`. Use local code-engine MCP tools only."

This calls **`build_container_image`** then **`login_to_registry`** then **`push_container_image`**:

```json
{
  "tool": "build_container_image",
  "arguments": {
    "dockerfile_path": "<absolute-path>/examples/deploy-mcp-server-to-code-engine/Dockerfile",
    "context_path": "<absolute-path>/examples/deploy-mcp-server-to-code-engine",
    "image_name": "us.icr.io/<your-icr-namespace>/ce-mcp-remote:latest"
  }
}
```

```json
{
  "tool": "login_to_registry",
  "arguments": {
    "registry": "us.icr.io",
    "username": "iamapikey"
  }
}
```

```json
{
  "tool": "push_container_image",
  "arguments": {
    "image_name": "us.icr.io/<your-icr-namespace>/ce-mcp-remote:latest"
  }
}
```

### Step 4 — Deploy the application

> "Using the local code-engine MCP tools only, create a Code Engine application named `ce-mcp-remote` in project `<project-id>` using image `us.icr.io/<your-icr-namespace>/ce-mcp-remote:latest`, pull secret `icr-pull-secret`, port 8080, min instances 0, max instances 10, with env var `IBMCLOUD_REGION=<your-region>`. Do NOT set IBMCLOUD_API_KEY as an env var."

Calls **`ce_create_application`**:

```json
{
  "tool": "ce_create_application",
  "arguments": {
    "project_id": "<project-id>",
    "name": "ce-mcp-remote",
    "image": "us.icr.io/<your-icr-namespace>/ce-mcp-remote:latest",
    "image_secret": "icr-pull-secret",
    "port": 8080,
    "scale_min_instances": 1,
    "scale_max_instances": 5,
    "scale_cpu_limit": "0.5",
    "scale_memory_limit": "1G",
    "env_vars": {
      "IBMCLOUD_REGION": "us-south"
    }
  }
}
```

> Do NOT include `IBMCLOUD_API_KEY` — the stateless bridge reads it from the `Authorization` header per-connection.

Response:
```json
{
  "name": "ce-mcp-remote",
  "status": "deploying",
  "endpoint": "https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud",
  "image_reference": "us.icr.io/<your-icr-namespace>/ce-mcp-remote:latest"
}
```

### Step 5 — Wait for ready

> "Wait for `ce-mcp-remote` in project `<project-id>` to become ready"

Calls **`ce_wait_for_app_ready`**:

```json
{
  "tool": "ce_wait_for_app_ready",
  "arguments": {
    "project_id": "<project-id>",
    "app_name": "ce-mcp-remote",
    "timeout_seconds": 180
  }
}
```

Response:
```json
{
  "status": "ready",
  "endpoint": "https://<app-name>.<subdomain>.<region>.codeengine.appdomain.cloud"
}
```

### Step 6 — Verify it's running

> "List the running instances of `ce-mcp-remote` in project `<project-id>`"

Calls **`ce_list_app_instances`**:

```json
{
  "tool": "ce_list_app_instances",
  "arguments": {
    "project_id": "<project-id>",
    "app_name": "ce-mcp-remote"
  }
}
```

---

## Configure your IDE

Once you have the URL, add the remote server to your IDE's MCP configuration.

### Antigravity IDE (`mcp_config.json`)

Antigravity uses `"mcpServers"` and `"serverUrl"` (camelCase), and supports `${env:VAR}` for the key:

```json
{
  "mcpServers": {
    "code-engine-remote": {
      "type": "sse",
      "serverUrl": "https://ce-mcp-remote.<subdomain>.<region>.codeengine.appdomain.cloud/sse",
      "headers": {
        "Authorization": "${env:IBMCLOUD_API_KEY}"
      }
    }
  }
}
```

Set your key before launching the IDE:
```bash
export IBMCLOUD_API_KEY="your-api-key-here"
```

### VS Code (`mcp.json`)

```json
{
  "servers": {
    "code-engine-remote": {
      "type": "sse",
      "url": "https://ce-mcp-remote.<subdomain>.<region>.codeengine.appdomain.cloud/sse",
      "headers": {
        "Authorization": "YOUR_IBMCLOUD_API_KEY"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "code-engine-remote": {
      "transport": {
        "type": "sse",
        "url": "https://ce-mcp-remote.<subdomain>.<region>.codeengine.appdomain.cloud/sse",
        "headers": {
          "Authorization": "YOUR_IBMCLOUD_API_KEY"
        }
      }
    }
  }
}
```

### Verify the connection

```bash
# Health check (expects "ok")
curl https://ce-mcp-remote.<subdomain>.<region>.codeengine.appdomain.cloud/health
```

---

---

## Option B — ibmcloud CLI script

Uses the `ibmcloud` CLI and plugins. Best for local dev or simple CI.

**Requirements:** `ibmcloud` CLI with `code-engine` and `container-registry` plugins, Docker or Podman.

```bash
# Install plugins if needed
ibmcloud plugin install code-engine
ibmcloud plugin install container-registry

# Run
chmod +x deploy-ibmcloud.sh
export IBMCLOUD_API_KEY="your-api-key-here"
./deploy-ibmcloud.sh
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `IBMCLOUD_API_KEY` | **required** | IBM Cloud API key |
| `IBMCLOUD_REGION` | `us-south` | IBM Cloud region |
| `CE_REGION` | `ca-tor` | Code Engine region |
| `CE_PROJECT` | `<your-project-name>` | Project name or ID |
| `APP_NAME` | `ce-mcp-remote` | Application name |
| `ICR_HOST` | `us.icr.io` | ICR hostname |
| `ICR_NAMESPACE` | `<your-icr-namespace>` | ICR namespace |
| `IMAGE_TAG` | `latest` | Image tag |
| `IMAGE_SECRET` | `icr-pull-secret` | CE pull secret name |
| `APP_PORT` | `8080` | Container port |
| `SCALE_MIN` | `0` | Min instances (0 = scale to zero) |
| `SCALE_MAX` | `10` | Max instances |

---

## Option C — REST API script (no CLI)

Uses `curl` + `jq` to call IBM Cloud REST APIs directly. No `ibmcloud` CLI needed.
Best for Docker-based CI/CD pipelines.

**Requirements:** `bash`, `curl`, `jq`, Docker or Podman.

```bash
chmod +x deploy-api.sh
export IBMCLOUD_API_KEY="your-api-key-here"
./deploy-api.sh
```

Supports the same environment variables as Option B.

### What it calls

| Step | IBM Cloud REST API |
|------|---------|
| Get IAM token | `POST https://iam.cloud.ibm.com/identity/token` |
| List projects | `GET https://api.<region>.codeengine.cloud.ibm.com/v2/projects` |
| Create/update secret | `POST/PATCH .../projects/<id>/secrets` |
| Create/update app | `POST/PATCH .../projects/<id>/apps` |
| Poll app status | `GET .../projects/<id>/apps/<name>` |

---

## Updating the deployment

When a new version of `code-engine-mcp-server` is published to npm, rebuild and redeploy with:

> "Rebuild and redeploy `ce-mcp-remote` in project `<project>` from `examples/deploy-mcp-server-to-code-engine` using the latest npm version"

The assistant calls `proc_build_push_deploy` again. Code Engine does a rolling update with zero downtime.

To pin a specific version, edit the `Dockerfile` build arg:

```dockerfile
ARG MCP_VERSION=1.0.7
RUN npm install -g code-engine-mcp-server@${MCP_VERSION}
```

Then rebuild.

---

## Scaling & cost

| Setting | Recommendation | Effect |
|---------|---------------|--------|
| `scale_min_instances: 1` | **Recommended** | Always-warm instance — in-memory tool stats persist. ~$0.008/vCPU-hour. |
| `scale_min_instances: 0` | Cost-first/dev | Scales to zero when idle — stats reset on each cold start. Cold start ~5–10 s. |
| `scale_max_instances: 5` | Team use | Allows up to 5 concurrent MCP sessions. |
| `scale_cpu_limit: 0.5` | Default | Sufficient for MCP tool calls (mostly API calls, not CPU-bound). |
| `scale_memory_limit: 1G` | Default | Sufficient for Node.js 20 + MCP server. |

Code Engine pricing: [ibm.com/cloud/code-engine/pricing](https://www.ibm.com/cloud/code-engine/pricing)

---

## Environment variables reference (bridge.mjs)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IBMCLOUD_REGION` | No | `us-south` | Default region for Code Engine operations. |
| `PORT` | No | `8080` | Port the SSE bridge listens on. |
| `MCP_BIN` | No | `node ./build/index.js` | Override the MCP server binary. |

> `IBMCLOUD_API_KEY` is **not** set as a Code Engine env var. The stateless `bridge.mjs` reads it from the `Authorization` header on each SSE connection.

---

## Security considerations

- **Stateless auth** — `IBMCLOUD_API_KEY` is never stored on the server. It is read from the `Authorization` header on each connection and injected into the spawned MCP process environment. The key never touches disk or logs.
- **API key scope** — consider creating a restricted API key (via IAM) that only has `Code Engine Operator` and `Container Registry Reader` roles rather than full account access.
- **SSE bridge** — `bridge.mjs` validates every POST body as valid JSON before forwarding to the MCP server, preventing malformed input from reaching the server.
- **Session IDs** — generated with `randomUUID()` (CSPRNG), not guessable.
- **No shell** — `bridge.mjs` uses `spawn()` (not `exec()`), so there is no shell injection surface.

---

## Troubleshooting

**App is stuck in `deploying` state**

> "Get the logs for `ce-mcp-remote` in project `<project-id>`"

Calls `ce_get_app_logs`. Common causes:
- ICR pull secret expired → ask assistant to call `ce_refresh_icr_pull_secret`
- Port mismatch — confirm the Dockerfile `EXPOSE` and app `port` are both `8080`

**MCP client says "connection refused" or times out**

```bash
curl https://ce-mcp-remote.<subdomain>.<region>.codeengine.appdomain.cloud/health
```

If this returns `ok`, the bridge is running. If not, check app logs.

If the app scales to zero (`scale_min_instances: 0`), the first request triggers a cold start (~5–10 s). The SSE client may time out before the container is ready. Either:
- Set `scale_min_instances: 1`, or
- Configure a longer connection timeout in your MCP client.

**"Session not found" on POST /message**

The SSE connection dropped and the session was cleaned up. Reconnect to `/sse` to get a new session ID.

**IDE shows tools but Copilot/assistant can't use them**

Reload the VS Code window (`Cmd+Shift+P` → **Reload Window**) after adding the server entry to `mcp.json`.

**How do I rotate the API key?**

> "Update the env var `IBMCLOUD_API_KEY` on app `ce-mcp-remote` in project `<project-id>` to `<new-key>`"

Calls `ce_update_application` with the new `env_vars`. Code Engine does a rolling restart.

---

## Reference — MCP tools used in this example

| Tool | When used |
|------|-----------|
| `ce_list_projects` | Find your project ID |
| `ce_create_project` | Create a new project if needed |
| `icr_list_namespaces` | Confirm your ICR namespace |
| `ce_create_secret` (format=registry) | Set up ICR pull credentials |
| `detect_container_runtime` | Find Docker or Podman |
| `build_container_image` | Build the custom image |
| `login_to_registry` | Authenticate to ICR |
| `push_container_image` | Upload to ICR |
| `ce_create_application` | Deploy the app |
| `ce_update_application` | Update image or env vars |
| `ce_wait_for_app_ready` | Poll until status = ready |
| `ce_list_app_instances` | Verify running pods |
| `ce_get_app_logs` | Diagnose problems |
| `ce_refresh_icr_pull_secret` | Refresh expired pull secret |
| `proc_build_push_deploy` | All of the above in one step |

---

## Author/Developer

Markus van Kempen  
Email: `markus.van.kempen@gmail.com` | `mvankempen@ca.ibm.com`  
Website: [markusvankempen.github.io](https://markusvankempen.github.io/)
