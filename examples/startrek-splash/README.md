# Star Trek / LCARS Splash Application

A Star Trek LCARS-themed splash page styled with the iconic orange/black panel design. Served by nginx on port 8080 inside an Alpine Linux container — ready to deploy to IBM Code Engine.

**Live demo:** https://startrek-splash.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud

---

## Features

- LCARS-style CSS panels (animated pulsing effect, orange/amber color scheme)
- Static HTML — no runtime dependencies
- nginx on port 8080 (required by IBM Code Engine)
- Built for `linux/amd64` (Code Engine runtime)

---

## Run locally

```bash
# Build (podman or docker both work)
podman build --platform linux/amd64 -t startrek-splash .

# Run — map host 8080 → container 8080
podman run -d -p 8080:8080 startrek-splash

# Verify
curl -I http://localhost:8080   # expect HTTP 200
```

---

## Deploy to IBM Code Engine

All steps below use the **Code Engine MCP tools** — no `ibmcloud` CLI required.

### Prerequisites

| Requirement | Value |
|---|---|
| ICR namespace | e.g. `my-namespace` |
| Code Engine project | e.g. `my-project` |
| IBM Cloud API key | Set as `IBMCLOUD_API_KEY` in your MCP server env |

### Step 1 — Validate the Dockerfile

```json
{ "tool": "proc_validate_dockerfile", "arguments": { "dockerfile_path": "examples/startrek-splash/Dockerfile" } }
```

### Step 2 — Build, push, and deploy in one step

```json
{
  "tool": "proc_build_push_deploy",
  "arguments": {
    "dockerfile_path": "examples/startrek-splash",
    "project_id_or_name": "my-project",
    "icr_namespace": "my-namespace",
    "app_name": "startrek-splash",
    "image_tag": "v1.0.0",
    "image_secret": "icr-pull-secret",
    "port": 8080
  }
}
```

`proc_build_push_deploy` automatically:
1. Validates the Dockerfile
2. Resolves the project ID
3. Builds the image for `linux/amd64`
4. Pushes it to ICR
5. **Refreshes the ICR pull secret** with current credentials (step 4.5 — prevents stale-token failures)
6. Creates or updates the Code Engine app
7. Polls until the revision is `ready`

---

## Troubleshooting

### App stuck in `no_revision_ready` with `reason: "unknown"`

This is the most common deployment failure. Two root causes produce identical symptoms:

#### Stale ICR pull secret

Code Engine can't pull the image because the registry secret's credentials have expired. Fix with:

```json
{
  "tool": "ce_refresh_icr_pull_secret",
  "arguments": {
    "project_id": "<your-project-id>",
    "secret_name": "icr-pull-secret",
    "icr_host": "us.icr.io"
  }
}
```

The tool uses the server's own `IBMCLOUD_API_KEY` — no API key input needed. Then redeploy.

> Since v1.0.8, `proc_build_push_deploy` refreshes the pull secret automatically before each deploy. Manual refresh is only needed when using `ce_create_application` or `ce_update_application` directly.

#### nginx port not rewritten (Alpine BusyBox `sed` limitation)

If your Dockerfile uses `\s*` in a `sed` pattern, the rewrite **silently fails** on Alpine because BusyBox `sed` does not support Perl regex escapes. nginx stays on port 80 while Code Engine health-checks 8080, so the revision never passes.

```dockerfile
# WRONG — \s* is Perl regex, not supported by Alpine BusyBox sed
RUN sed -i 's/listen\s*80;/listen 8080;/g' /etc/nginx/conf.d/default.conf

# CORRECT — POSIX [[:space:]]* works everywhere
RUN sed -i 's/listen[[:space:]]*80;/listen 8080;/g' /etc/nginx/conf.d/default.conf \
 && sed -i 's/listen[[:space:]]*\[::\]:80;/listen [::]:8080;/g' /etc/nginx/conf.d/default.conf
```

See [docs/MCP_INSPECTOR_TROUBLESHOOTING.md](../../docs/MCP_INSPECTOR_TROUBLESHOOTING.md) for the full diagnosis guide.

---

## File structure

| File | Purpose |
|---|---|
| `index.html` | LCARS-themed splash page |
| `Dockerfile` | Alpine nginx container, port 8080 |
| `README.md` | This file |

## License

MIT
