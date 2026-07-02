# Provenance — Chat Commands & Prompt Language

Natural-language prompts for the **optional** provenance addon (`provenance-addon/`). This is **not** required for Code Engine MCP deploy, build, or manage workflows — enable it only when you want signed receipts.

**Status:** experimental v0.1 — supplemental evidence, not a security guarantee. See [README](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/provenance-addon/README.md#what-it-does-and-does-not-prove).

**Core deploy docs (no provenance):** [startrek-splash README](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/examples/startrek-splash/README.md) · [starwars-splash README](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/examples/starwars-splash/README.md)

**Related:** [PROVENANCE-E2E-FLOW.md](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/provenance-addon/PROVENANCE-E2E-FLOW.md) · [README](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/provenance-addon/README.md)

---

## Documented example: startrek-splash MCP deploy + receipts

Reference run using **only** MCP tool `proc_build_push_deploy` (July 2026). Full walkthrough: [examples/startrek-splash/README.md](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/examples/startrek-splash/README.md#documented-example-flow-verified-deploy).

**Chat prompt:**

> Using only Code Engine MCP tools, deploy `examples/startrek-splash` to Code Engine project — show provenance receipts and the live app URL.

**Note:** If Cursor’s MCP panel lacks `IBMCLOUD_API_KEY`, export it in the shell (`source code-engine-mcp-server/.env`) and ensure `.cursor/mcp.json` passes `"IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}"`, then restart the `code-engine` MCP server.

| Outcome | Value |
|---------|-------|
| Live URL | https://startrek-splash.jqu1wkh2th6.us-south.codeengine.appdomain.cloud |
| Status | `ready` (HTTP 200, ~22s) |
| Image | `us.icr.io/mvk-code-engine/startrek-splash:v1.0.0-startrek-mcp` |
| Revision | `startrek-splash-00001` |

**`provenance_receipts` from MCP response** (when `PROVENANCE_ENABLED=true`):

```
provenance-addon/receipts/live/2026-07-02T15-18-40-177Z-ce_validate_dockerfile-33e7de72-b9b3-4f09-98a5-ab1be77a95e2.json
provenance-addon/receipts/live/2026-07-02T15-19-12-343Z-proc_build_push_deploy-a0892d09-7de8-4ca4-bd28-77c83a4078fd.json
```

**Verify:**

```bash
cd provenance-addon
node verify-receipt.mjs --key-dir .keys receipts/live/2026-07-02T15-18-40-177Z-ce_validate_dockerfile-*.json receipts/live/2026-07-02T15-19-12-343Z-proc_build_push_deploy-*.json
```

```
✅ 2 verified, 0 failed — integrity confirmed
```

Deploy receipt claim: `session:cursor-local`, `app:startrek-splash@c6fd163e-ef8c-4a30-a424-8e3d886caec6`, status `executed`.

---

## Linking receipts to **this** chat

Receipts do **not** auto-detect which Cursor/VS Code chat created them. You label them with env vars before running MCP tools:

| Receipt field | Env var | Meaning |
|---------------|---------|---------|
| `claim.session_id` | `PROVENANCE_SESSION_ID` | Machine id for one AI chat thread |
| `claim.task_id` | `PROVENANCE_TASK_ID` | Machine id for one user prompt / goal |
| `claim.chat_label` | `PROVENANCE_CHAT_LABEL` | **Human-readable chat title** (e.g. "Deploy Star Trek splash demo") |
| `claim.task_label` | `PROVENANCE_TASK_LABEL` | **Human-readable ask** (e.g. "One-shot MCP deploy with receipts") |
| `claim.human_summary` | _(auto per tool)_ | **One-line step description** (e.g. "Deploy startrek: Build, push & deploy startrek-splash — succeeded") |
| `claim.lineage_ref` | `PROVENANCE_LINEAGE_REF` | Optional ticket, PR, or epic (`ticket:ENG-417`) |
| `claim.target_ref` | _(from tool)_ | What was acted on (`app:startrek-splash@…`, file path) |
| `claim.trace_ref` | _(defaults to session_id)_ | Operational trace grouping |

### Before a deploy — say in chat

> Label this chat for provenance: set `PROVENANCE_CHAT_LABEL="Deploy Star Trek splash demo"`, `PROVENANCE_TASK_LABEL="One-shot MCP deploy with live receipts"`, `PROVENANCE_SESSION_ID=session:startrek-deploy-20260702`, and `PROVENANCE_TASK_ID=task:deploy-startrek` in `.env` and MCP env, then restart MCP before we deploy.

**Example `.env` block:**

```bash
PROVENANCE_CHAT_LABEL=Deploy Star Trek splash demo
PROVENANCE_TASK_LABEL=One-shot MCP deploy with live receipts
PROVENANCE_SESSION_ID=session:startrek-deploy-20260702
PROVENANCE_TASK_ID=task:deploy-startrek
```

### In the visualizer

1. **Correlation bar** (below timeline) — shows `session_id`, `task_id`, `lineage_ref`, and `target_ref` for the selected receipt.
2. **Chat sessions dropdown** — filters when you have multiple distinct `session_id` values.
3. **Right panel → AI Chat Sessions** — click a session card to filter the timeline.
4. **Detail panel → Trace Context** — shows “step N of M in this task” within the session.

### Warning: static labels

If every receipt shows `session:cursor-local` and `task:write-files` (from a shared `.env`), **all chats look the same**. Change `PROVENANCE_SESSION_ID` per chat to tell them apart.

---

## Quick reference

| Goal | Say this in chat |
|------|------------------|
| Turn provenance **on** | *"Enable provenance in `.env` and restart the Code Engine MCP server."* |
| Turn provenance **off** | *"Disable provenance — set `PROVENANCE_ENABLED=false` in `.env` and restart MCP."* |
| Label this chat session | *"Set `PROVENANCE_SESSION_ID=session:my-feature-xyz` for this chat's receipts."* |
| Write a file + receipt | *"Use `write_or_modify_file` to create `<path>` — provenance should emit a signed receipt."* |
| Deploy with validation gates | *"Use MCP `proc_build_push_deploy` only (no deploy scripts). Provenance receipts appear in `provenance_receipts`."* |
| Verify receipts | *"Verify paths from `provenance_receipts` with `verify-receipt.mjs` and our public key."* |
| Inspect receipts visually | *"Open `provenance-addon/visualizer.html` and load the latest deploy receipts."* |
| Run interop self-test | *"Run `npm run interop:ci` and `npm run test:lab:verify` in `provenance-addon/`."* |

---

## 1. Enable or disable provenance

Provenance is **off by default**. Toggle it in `code-engine-mcp-server/.env`, then **restart the MCP server** (Cursor: MCP panel → restart `code-engine`).

### Enable (recommended for local dev)

**Ask your assistant:**

> Enable provenance for the Code Engine MCP server. Set `PROVENANCE_ENABLED=true` in `code-engine-mcp-server/.env` with these paths:
> - `PROVENANCE_KEY_DIR` → `provenance-addon/.keys`
> - `PROVENANCE_RECEIPTS_DIR` → `provenance-addon/receipts/live`
> - `PROVENANCE_WORKSPACE_ROOT` → my workspace root (the folder the agent may write under)
> - `PROVENANCE_SESSION_ID` → `session:cursor-local`
>
> Align `.cursor/mcp.json` env with the same values, then rebuild and tell me when to restart MCP.

**Example `.env` block** (see also [`.env.example`](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/.env.example)):

```bash
PROVENANCE_ENABLED=true
PROVENANCE_KEY_DIR=/absolute/path/to/code-engine-mcp-server/provenance-addon/.keys
PROVENANCE_RECEIPTS_DIR=/absolute/path/to/code-engine-mcp-server/provenance-addon/receipts/live
PROVENANCE_WORKSPACE_ROOT=/absolute/path/to/your/workspace
PROVENANCE_SESSION_ID=session:cursor-local
PROVENANCE_TASK_ID=task:write-files
PROVENANCE_GIT_REF=main@abc123
PROVENANCE_LINEAGE_REF=ticket:ENG-417
```

### Disable

**Ask your assistant:**

> Turn off provenance — set `PROVENANCE_ENABLED=false` in `.env` (or comment out the provenance block). Restart the Code Engine MCP server when done.

### Confirm it is active

**Ask your assistant:**

> Is provenance enabled on the Code Engine MCP server? Check `.env` and MCP startup logs for `[provenance] enabled`.

Expected MCP stderr on startup when on:

```text
[provenance] enabled — keys: .../provenance-addon/.keys receipts: .../receipts/live workspace: ...
```

---

## 2. Session, task, and lineage labels

Receipts include correlation fields so you can group actions from one chat or ticket.

| Variable | Chat naming convention | Example value |
|----------|------------------------|---------------|
| `PROVENANCE_SESSION_ID` | One per chat thread | `session:starwars-deploy-2026-07-02` |
| `PROVENANCE_TASK_ID` | Sub-task within a session | `task:dockerfile-fix` |
| `PROVENANCE_GIT_REF` | Branch + commit | `main@2ef1e1b` |
| `PROVENANCE_LINEAGE_REF` | Ticket / epic / PR | `ticket:ENG-417` or `pr:#42` |

**Ask your assistant:**

> For this conversation, use provenance session `session:feature-auth-refactor`, task `task:write-config`, git ref `main@HEAD`, and lineage `ticket:AUTH-99`. Update `.env` and confirm before writing files.

**Ask your assistant (deploy-only session):**

> Label this deploy with `PROVENANCE_SESSION_ID=session:starwars-deploy` and `PROVENANCE_LINEAGE_REF=deploy:starwars-provenance-script`.

---

## 3. File writes with signed receipts

When provenance is enabled, the MCP tool `write_or_modify_file` emits a signed receipt after each successful write (fail-open: the write still succeeds if receipt creation fails).

**Ask your assistant:**

> Using the Code Engine MCP `write_or_modify_file` tool, create `cursor-test.txt` in the provenance workspace with a one-line timestamp. Provenance should be on — show me the receipt path when done.

**Ask your assistant (with artifact binding):**

> Write `examples/starwars-splash/Dockerfile` changes via MCP and confirm the receipt includes an `artifact_hash` that matches the file on disk.

**Verify after a write:**

> Verify the latest receipt in `provenance-addon/receipts/live/` with `verify-receipt.mjs` and our public key in `provenance-addon/.keys/public.pem`.

Shell equivalent:

```bash
cd code-engine-mcp-server/provenance-addon
node verify-receipt.mjs --key-dir .keys receipts/live/*.json
```

---

## 4. Deploy with provenance via MCP (Star Wars example)

Use **Code Engine MCP tools only** — do not use npm deploy scripts. With `PROVENANCE_ENABLED=true`, `proc_build_push_deploy` emits signed receipts and returns their paths in `provenance_receipts`.

**Ask your assistant (one-shot):**

> Using **only Code Engine MCP tools**, deploy `examples/starwars-splash` to project `<project-id>` as app `starwars-splash`, ICR namespace `<namespace>`, pull secret `icr-pull-secret`, tag `v1.0.0`, port 8080. Provenance on — show `provenance_receipts`, app URL, and confirm status `ready`.

**Ask your assistant (step-by-step):**

> 1) Confirm provenance enabled. 2) Call `proc_build_push_deploy` for `examples/starwars-splash`. 3) Call `ce_get_application` to confirm `ready`. 4) Verify every file in `provenance_receipts` with `verify-receipt.mjs`. 5) Run `verify-artifact.mjs` on the Dockerfile receipt.

**Optional pre-flight (provenance verifier health, not deploy):**

> Run `interop:ci` and `test-lab:verify` in `provenance-addon/` before we deploy via MCP.

Receipt output: `PROVENANCE_RECEIPTS_DIR` (default `provenance-addon/receipts/live/`)

---

## 4b. Deploy with provenance via MCP (Star Trek / LCARS example)

See **[Documented example: startrek-splash MCP deploy + receipts](#documented-example-startrek-splash-mcp-deploy--receipts)** above for the verified run (URL, receipts, verification output).

Same MCP-only flow for [`examples/startrek-splash`](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/examples/startrek-splash) — core deploy steps are in the example README; this section is only if provenance is enabled.

**Ask your assistant (one-shot):**

> Using **only Code Engine MCP tools** (no npm deploy scripts), deploy `examples/startrek-splash` to project `<project-id>` as app `startrek-splash`, ICR namespace `mvk-code-engine`, pull secret `icr-pull-secret`, image tag `v1.0.0-startrek`, port 8080. Provenance must be on — return `provenance_receipts`, live URL, and deployment status.

**Ask your assistant (validate deployment + provenance):**

> After MCP deploy of `startrek-splash`: `ce_get_application` must show `ready`; curl the endpoint for HTTP 200. Verify all paths in `provenance_receipts` with `verify-receipt.mjs` and bind the Dockerfile receipt with `verify-artifact.mjs`. Open `visualizer.html`.

**MCP tool arguments reference:**

```json
{
  "tool": "proc_build_push_deploy",
  "arguments": {
    "context_path": "examples/startrek-splash",
    "project_id_or_name": "<project-id>",
    "icr_namespace": "mvk-code-engine",
    "app_name": "startrek-splash",
    "image_tag": "v1.0.0-startrek",
    "image_secret": "icr-pull-secret",
    "port": 8080,
    "timeout_seconds": 300
  }
}
```

Example live demo (reference): https://startrek-splash.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud

---

## 5. Verify, audit, and tamper-check

**Ask your assistant:**

> Verify every JSON receipt in `provenance-addon/receipts/starwars-deploy/` — signatures must pass with `provenance-addon/.keys/public.pem`.

**Ask your assistant (artifact bind):**

> Run `verify-artifact.mjs` on the starwars Dockerfile receipt — confirm `artifact_hash` matches `examples/starwars-splash/Dockerfile`.

**Ask your assistant (tamper demo):**

> Run the provenance tamper demo and explain which receipts should fail verification: `node provenance-addon/demo-tamper-scenarios.mjs`

**Ask your assistant (interop health):**

> Run provenance interop CI locally: `cd provenance-addon && npm run interop:ci && npm run test:lab:verify`. Report pass/fail counts.

---

## 6. Visualizer and test lab

### Receipt visualizer (browser)

**Ask your assistant:**

> Open `provenance-addon/visualizer.html` in the browser. I'll load receipts from `provenance-addon/receipts/starwars-deploy/` — walk me through what each step means.

Manual steps:

1. Open `provenance-addon/visualizer.html`
2. **Load Receipt JSON Files** → select receipts from `receipts/live/`, `receipts/starwars-deploy/`, or demo folders
3. Use the receipt selector to step through the deployment timeline

### Test lab dashboard

**Ask your assistant:**

> Start the provenance test lab: `cd provenance-addon && npm run test:lab` (or `bash run-test-lab.sh`), then open the URL it prints.

Headless verify (CI-style):

```bash
cd provenance-addon && npm run test:lab:verify
```

---

## 7. Troubleshooting prompts

| Symptom | Ask your assistant |
|---------|-------------------|
| No receipts after write | *"Check `PROVENANCE_ENABLED`, MCP restart, and stderr for `[provenance]` errors. Run `npm run test:provenance-write`."* |
| `write_or_modify_file` path rejected | *"Confirm the path is under `PROVENANCE_WORKSPACE_ROOT`."* |
| Push failed / unauthorized | *"Run `proc_build_push_deploy` again — it should ICR-login before push. Check `IBMCLOUD_API_KEY`."* |
| Deploy script says `deploy aborted` | *"Show the full MCP JSON error from `proc_build_push_deploy` — not just the summary."* |
| Signature verify fails | *"Was the receipt edited after signing? Re-run verify with the correct `public.pem` from `.keys/`."* |
| Artifact hash mismatch | *"Compare receipt `artifact_hash` to `sha256` of the file bytes — file may have changed after signing."* |

---

## 8. What the agent should do (checklist)

When you ask for provenance-backed work, a well-configured assistant should:

1. **Check** `PROVENANCE_ENABLED=true` in `.env` and MCP env (e.g. `.cursor/mcp.json`)
2. **Set** session/task/lineage IDs when you specify them
3. **Use MCP tools** (`write_or_modify_file`, `proc_build_push_deploy`) rather than shell writes when receipts are required
4. **Run gates** (`interop:ci`, `test-lab:verify`) before provenance-gated deploys
5. **Report** receipt file paths and verification results
6. **Never** commit `.env`, private keys, or API keys

---

## 9. npm scripts (terminal)

From `code-engine-mcp-server/`:

| Script | Command |
|--------|---------|
| Provenance write smoke test | `npm run test:provenance-write` |
| Interop CI | `cd provenance-addon && npm run interop:ci` |
| Test lab verify | `cd provenance-addon && npm run test:lab:verify` |
| Test lab browser | `cd provenance-addon && npm run test:lab` |

---

## Author

Markus van Kempen · [markus.van.kempen@gmail.com](mailto:markus.van.kempen@gmail.com) · [markusvankempen.github.io](https://markusvankempen.github.io/)
