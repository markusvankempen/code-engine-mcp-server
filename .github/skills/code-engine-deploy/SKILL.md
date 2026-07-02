---
name: code-engine-deploy
description: 'IBM Code Engine deployment skill. Use when deploying, managing, or troubleshooting IBM Code Engine applications, jobs, secrets, config maps, domain mappings, container builds, or ICR images. Use for: deploy to code engine, code engine app, code engine job, build container image, push image, ICR registry, MCP tools, build and deploy, proc_build_push_deploy, local or remote MCP server.'
argument-hint: 'Optional: describe what you want to deploy or manage'
---

# IBM Code Engine Deployment Skill

## When to Use
Invoke this skill whenever the task involves:
- Deploying or updating a Code Engine **application** or **job**
- Building and pushing a **container image** (local Docker/Podman → ICR)
- Managing Code Engine **projects**, **secrets**, **config maps**, or **domain mappings**
- Checking **app logs**, **revisions**, or **job runs**
- Setting up or renewing **TLS / custom domains**
- Any task touching the IBM Cloud Container Registry (ICR)

---

## MCP Server Selection

Before performing any Code Engine task, determine which MCP server to use:

### 1. Prefer Remote (if available)
Check whether the `remote-code-engine` MCP server is configured and reachable:
- Use `mcp-remote` pointing to the bridge URL (e.g. `https://ce-mcp-remote.<hash>.<region>.codeengine.appdomain.cloud/sse`)
- If the remote server responds, **use it exclusively** — it avoids running a local node process and is already authenticated via the bridge.

### 2. Fall back to Local
If remote is unavailable or not configured, use the local `code-engine` stdio server:
- Launched via `npx -y code-engine-mcp-server@latest`
- Requires `IBMCLOUD_API_KEY` and `IBMCLOUD_REGION` env vars

> **Rule**: Use ONLY Code Engine MCP tools for all deployment operations. Do not shell out to `ibmcloud` CLI, `docker`, or `kubectl` directly.

---

## MCP Setup Guide

### Prerequisites
- **Node.js 18+** — verify: `node --version`
- **IBM Cloud API key** — create at [cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys)
  - Required IAM permissions: **Code Engine Editor** + **Container Registry Reader**

---

### API Key Storage (choose one)

**Option A — Shell env var (recommended)**
```bash
cp dot.env.example .env   # .env is already in .gitignore
# Edit .env: IBMCLOUD_API_KEY=your-key-here
source .env
# Or permanently: echo 'export IBMCLOUD_API_KEY="your-key"' >> ~/.zshrc
```
Reference in any config file as `"${env:IBMCLOUD_API_KEY}"` — the key never appears in the file.

**Option B — VS Code input prompt** (prompted each time the server starts)
```json
{
  "inputs": [{ "id": "ibmcloud-api-key", "type": "promptString", "description": "IBM Cloud API key", "password": true }],
  "servers": {
    "code-engine": {
      "type": "stdio", "command": "npx", "args": ["-y", "code-engine-mcp-server@latest"],
      "env": { "IBMCLOUD_API_KEY": "${input:ibmcloud-api-key}", "IBMCLOUD_REGION": "us-south" }
    }
  }
}
```

**Option C — Inline value** (personal machine only — add config file to `.gitignore`)

---

### Local Server Setup

**Environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `IBMCLOUD_API_KEY` | ✅ | IBM Cloud API key |
| `IBMCLOUD_REGION` | optional | Default region: `us-south`, `ca-tor`, `eu-de` |
| `CONTAINER_RUNTIME` | optional | Override runtime: `docker` or `podman` |

**VS Code** — open via `Cmd+Shift+P` → "MCP: Open User MCP Config":
```json
{
  "servers": {
    "code-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": {
        "IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}",
        "IBMCLOUD_REGION": "us-south"
      }
    }
  }
}
```

**VS Code Extension (easiest — no mcp.json editing)**
Install **[MarkusvanKempen.code-engine-mcp](https://marketplace.visualstudio.com/items?itemName=MarkusvanKempen.code-engine-mcp)**:
1. Open the **IBM Code Engine MCP** sidebar (cloud icon in Activity Bar)
2. Paste API key → **Save** → **Configure MCP** → **Run Diagnostics** ✅

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "code-engine": {
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": { "IBMCLOUD_API_KEY": "YOUR_KEY", "IBMCLOUD_REGION": "us-south" }
    }
  }
}
```

**From local build** (development / testing):
```json
{
  "servers": {
    "code-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/code-engine-mcp-server/build/index.js"],
      "env": { "IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}", "IBMCLOUD_REGION": "ca-tor" }
    }
  }
}
```

---

### Remote Server Setup

Runs on IBM Code Engine (ca-tor) — no local Node.js process needed. Auth is passed per-connection via the `Authorization` header. Scales to zero when idle (first request ~5s wake-up time).

**Bridge URL pattern**: `https://ce-mcp-remote.<hash>.<region>.codeengine.appdomain.cloud/sse`
**Current bridge**: `https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse`

**VS Code** (SSE transport):
```json
{
  "servers": {
    "code-engine-remote": {
      "type": "sse",
      "url": "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse",
      "headers": { "Authorization": "${env:IBMCLOUD_API_KEY}" }
    }
  }
}
```

**Via `mcp-remote`** (for clients that don't support SSE natively):
```json
{
  "servers": {
    "code-engine-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse"],
      "env": { "IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}" }
    }
  }
}
```

**Claude Desktop** (SSE transport):
```json
{
  "mcpServers": {
    "code-engine-remote": {
      "transport": {
        "type": "sse",
        "url": "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse",
        "headers": { "Authorization": "YOUR_KEY" }
      }
    }
  }
}
```

---

### Both Servers Together (VS Code)

```json
{
  "servers": {
    "code-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": { "IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}", "IBMCLOUD_REGION": "us-south" }
    },
    "code-engine-remote": {
      "type": "sse",
      "url": "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse",
      "headers": { "Authorization": "${env:IBMCLOUD_API_KEY}" }
    }
  }
}
```

---

### Verify the Connection

After configuring, test with:
> *"Can you detect which container runtime I have installed?"*

The assistant should respond with your Docker or Podman version.

---

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` | `echo $IBMCLOUD_API_KEY` — if empty, run `source .env` or add to shell profile |
| Tools show `undefined` | Run Diagnostics (extension sidebar) or check `tools/list` in [MCP Inspector](https://github.com/modelcontextprotocol/inspector) |
| `Cannot find module` | Use `npx -y code-engine-mcp-server@latest` or build: `npm install && npm run build` |
| `node` not found | Node.js 18+ required — install from [nodejs.org](https://nodejs.org) |
| App stuck `no_revision_ready` | `ce_refresh_icr_pull_secret` then re-deploy; see [MCP_INSPECTOR_TROUBLESHOOTING.md](../../../docs/MCP_INSPECTOR_TROUBLESHOOTING.md) |
| Remote slow first request | Normal — remote scales to zero, wake-up ~5s |

### Security Checklist
- [ ] `.env` is in `.gitignore` (already set in this repo)
- [ ] `.vscode/mcp.json` is in `.gitignore` if it contains inline credentials
- [ ] Use `${env:IBMCLOUD_API_KEY}` or `${input:...}` — never commit a key inline
- [ ] API key has minimum required IAM permissions only

---

## Tool Reference

### Container / Registry Tools
| Tool | Purpose |
|------|---------|
| `detect_container_runtime` | Find Docker or Podman on the local machine |
| `build_container_image` | Build image from a Dockerfile |
| `test_container_locally` | Run a container locally to validate it |
| `tag_container_image` | Tag image for a target registry |
| `login_to_registry` | Authenticate to ICR or Docker Hub |
| `push_container_image` | Push image to ICR |
| `list_local_images` | List locally built images |
| `inspect_container_image` | Inspect image metadata |
| `prune_images` | Remove unused local images |
| `remove_local_image` | Remove a specific local image |
| `icr_list_namespaces` | List ICR namespaces |
| `icr_create_namespace` | Create an ICR namespace |
| `icr_list_images` | List images in ICR |
| `icr_delete_image` | Delete an image from ICR |
| `iam_get_token_info` | Check current IAM token validity |

### Code Engine — Projects
| Tool | Purpose |
|------|---------|
| `ce_list_projects` | List all projects in a region |
| `ce_create_project` | Create a new project |
| `ce_get_project` | Get project details |
| `ce_get_project_status` | Get project readiness status |
| `ce_delete_project` | Delete a project |
| `ce_list_egress_ips` | List public egress IPs (for firewall allowlisting) |

### Code Engine — Applications
| Tool | Purpose |
|------|---------|
| `ce_list_applications` | List apps in a project |
| `ce_create_application` | Create/deploy an application |
| `ce_get_application` | Get application details |
| `ce_update_application` | Update image, env, scale settings |
| `ce_delete_application` | Delete an application |
| `ce_wait_for_app_ready` | Poll until app is ready (use after deploy) |
| `ce_get_app_logs` | Stream or fetch application logs |
| `ce_list_app_revisions` | List all revisions |
| `ce_get_app_revision` | Get a specific revision |
| `ce_list_app_instances` | List running pods/instances |
| `ce_get_app_instance` | Get a specific instance |
| `ce_refresh_icr_pull_secret` | Refresh ICR pull secret to fix stale credential errors |

### Code Engine — Jobs
| Tool | Purpose |
|------|---------|
| `ce_list_jobs` | List job definitions |
| `ce_create_job` | Create a job definition |
| `ce_get_job` | Get job details |
| `ce_update_job` | Update a job |
| `ce_delete_job` | Delete a job |
| `ce_create_job_run` | Submit a job run |
| `ce_get_job_run` | Get job run status/output |
| `ce_list_job_runs` | List all job runs |

### Code Engine — Configuration
| Tool | Purpose |
|------|---------|
| `ce_list_secrets` | List secrets |
| `ce_create_secret` | Create a secret (registry, generic, SSH) |
| `ce_get_secret` | Get secret details |
| `ce_update_secret` | Update a secret |
| `ce_delete_secret` | Delete a secret |
| `ce_create_tls_secret_from_pem` | Create TLS secret from PEM files |
| `ce_renew_tls_secret_from_pem` | Renew/update an existing TLS secret |
| `ce_list_config_maps` | List config maps |
| `ce_create_config_map` | Create a config map |
| `ce_get_config_map` | Get config map details |
| `ce_update_config_map` | Update a config map |
| `ce_delete_config_map` | Delete a config map |
| `ce_list_bindings` | List service bindings |
| `ce_create_binding` | Bind a service to an app/job |
| `ce_get_binding` | Get binding details |
| `ce_delete_binding` | Delete a binding |

### Code Engine — Domain Mappings
| Tool | Purpose |
|------|---------|
| `ce_list_domain_mappings` | List custom domain mappings |
| `ce_create_domain_mapping` | Create a domain mapping |
| `ce_get_domain_mapping` | Get domain mapping details |
| `ce_update_domain_mapping` | Update a domain mapping |
| `ce_delete_domain_mapping` | Delete a domain mapping |

### Orchestration Procedures (Multi-step)
| Tool | Purpose |
|------|---------|
| `proc_build_push_deploy` | **Full pipeline**: build → tag → login → push → deploy app → wait for ready. Use this for end-to-end deployments. |
| `proc_setup_custom_domain` | Set up a custom domain with TLS on an existing app |

---

## Standard Deployment Workflow

For a typical "build and deploy" request, follow this sequence:

1. **Detect runtime** — `detect_container_runtime`
2. **Use `proc_build_push_deploy`** (preferred single-tool approach):
   - Provide: `project_id`, `app_name`, `image` (ICR path), `dockerfile_path`, `registry_secret`, `ibmcloud_api_key`
   - It handles: build → tag → login → push → deploy → ICR pull secret refresh → wait for ready
3. **Verify** — `ce_get_application` or `ce_get_app_logs` to confirm success

If the app already exists and only the image needs updating:
1. `ce_update_application` with the new image reference
2. `ce_wait_for_app_ready`

---

## Common Patterns

### Fix "no_revision_ready" / stale pull secret
```
ce_refresh_icr_pull_secret(project_id, secret_name)
ce_update_application(project_id, app_name, image=<same image>)
ce_wait_for_app_ready(project_id, app_name)
```

### Deploy a new app from scratch
```
proc_build_push_deploy(project_id, app_name, image, dockerfile_path, ...)
```

### Check what's running
```
ce_list_projects()        → find project_id
ce_list_applications(project_id)
ce_get_app_logs(project_id, app_name)
```

### Set up custom domain with TLS
```
proc_setup_custom_domain(project_id, app_name, domain, tls_cert_file, tls_key_file)
```

---

## Provenance (optional)

Experimental v0.1 signed receipts for selected MCP actions. **Off by default.**

**Chat prompt guide:** [provenance-addon/PROVENANCE-CHAT-COMMANDS.md](../../provenance-addon/PROVENANCE-CHAT-COMMANDS.md)

When the user asks for provenance-backed work:

1. Confirm `PROVENANCE_ENABLED=true` in `.env` and MCP env; restart MCP if changed
2. Set `PROVENANCE_SESSION_ID` / `PROVENANCE_TASK_ID` when the user labels a chat or ticket
3. **Deploy using MCP `proc_build_push_deploy`** — do not use npm deploy scripts unless the user explicitly asks
4. Prefer `write_or_modify_file` (MCP) over shell writes when receipts are required
5. Optional pre-flight: `interop:ci` + `test-lab:verify` in `provenance-addon/` (verifier health, not deploy)
6. Report `provenance_receipts` from MCP responses and run `verify-receipt.mjs` when asked to audit

**Example user prompts:**

```
Using only Code Engine MCP tools, deploy examples/startrek-splash with provenance on.
```

```
Verify paths in provenance_receipts from the last proc_build_push_deploy call.
```
