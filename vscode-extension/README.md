# IBM Code Engine MCP — VS Code Extension

> **v1.7.8** — Bundled MCP server matches `code-engine-mcp-server@1.7.8`: **28 tools** (one per resource with an `action` field, all earlier capability kept), a **shared local HTTP server** by default so chat, the IDE MCP list and the web UI use one process, **MCP Remote Config** inside VS Code, a *Remote client* tab in the web UI, and a check that a server really is a code-engine MCP server. On startup the extension checks npmjs and can pull a newer server into local storage when one is published.

Deploy containerised apps to **IBM Code Engine** using natural language. This extension wires up the `code-engine-mcp-server` as an [MCP](https://modelcontextprotocol.io) server so any AI assistant running in your IDE (GitHub Copilot, Cline, Cursor, etc.) can build images, push them to IBM Container Registry, and deploy apps — all from a chat prompt.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=MarkusvanKempen.code-engine-mcp)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Registry-C160EF?logo=eclipseide&logoColor=white)](https://open-vsx.org/extension/markusvankempen/code-engine-mcp)
[![npm](https://img.shields.io/npm/v/code-engine-mcp-server.svg?label=npm)](https://www.npmjs.com/package/code-engine-mcp-server)
[![Release](https://img.shields.io/badge/release-v1.7.8-blue)](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/CHANGELOG.md)

---

## What can it do?

Once configured, you can talk to your AI assistant and say things like:

> *"List all my Code Engine projects and show me all the running apps in each project."*

> *"Build my app for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first."*

> *"Deploy the developer-splash image to my Code Engine project. Check if I have a registry pull secret first, and create one if needed."*

The assistant calls the MCP tools behind the scenes — no CLI commands to remember. The server publishes 28 tools (for example `ce_app`, `ce_job`, `ce_secret`, each with an `action` such as `list`, `get`, `create`, `delete`); see the [tool reference](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/docs/TOOLS.md).

### MCP Remote Config

The sidebar **Remote Config** tab (or **IBM Code Engine MCP: Open MCP Remote Config**) opens a native panel for configuring and testing an MCP server: run any tool with a schema-driven form, change logging and read the audit trace, manage users and MCP API keys, and watch live server events. It follows your VS Code theme.

- **This computer**: the panel uses the same connection as Setup → Server connection (its address field is read-only and follows that choice). With the default *Shared HTTP server*, the extension starts the bundled server on `127.0.0.1` (port `codeEngineMcp.localHttpPort`, default 8787) with the admin login `admin` / `admin` (change it with the setting `codeEngineMcp.localAdminPassword`; leave it empty to get a generated password, then use *Copy admin password*). The panel signs in for you.
- **Remote server**: the panel talks to the URL saved under Setup, using the saved credential. Any host works (Code Engine, Render, Fly.io, a VM).

The panel can only reach this machine and the saved remote server, and it never sees the stored credential.

**Wrong server check.** The extension confirms that an address is a code-engine MCP server (by `/health`, the MCP server name, or the `describe_server` tool). If it is a different MCP server, Test connection names it, the connection is not saved, chat does not use it, and the panel blocks its forms.

### Code Engine Resource Tree

The **IBM Code Engine** sidebar includes a native **Code Engine Resource Tree**:

- Browse your **projects** and expand each to see its **applications, jobs, builds, secrets, and config maps**.
- Apps show a status dot (🟢 ready / 🟡 pending); click an app to open its URL in the browser.
- Right-click (or use the inline icons) for quick actions:
  - **App** — Open in Browser, View Logs, View Events, Restart, Delete
  - **Build** — View Build, Delete
  - **Job / Secret / Config Map** — Delete
- Use the **Refresh** button in the tree title bar to reload; the tree also refreshes automatically when you change your API key.

You can reveal the tree from **Setup & Diagnostics → Code Engine Resource Tree**, or via **IBM Code Engine MCP: Show Quick Menu → Open Code Engine Resource Tree**.

### Watch it live (v1.4.0)

Open **IBM Code Engine MCP: Open MCP Activity Dashboard** from the Command Palette to see tool calls as they happen — session timeline, deploy outcomes, live URLs, and a **Deployments** tab to manage apps already on Code Engine.

---

## Prerequisites

- **VS Code 1.101+** with an AI assistant that supports MCP (GitHub Copilot Chat, Cline, etc.)
- **Node.js** on your system PATH
- A valid **IBM Cloud API key** — get one at [cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys)

---

## Getting started

### 1. Install the extension

| IDE / Platform | Install |
|---|---|
| **VS Code** | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=MarkusvanKempen.code-engine-mcp) |
| **Cursor / Theia / Gitpod / Codium** | [Open VSX Registry](https://open-vsx.org/extension/markusvankempen/code-engine-mcp) |
| **Local VSIX** | **Command Palette** → **Extensions: Install from VSIX…** |

### 2. Enter your API key

Open the **IBM Code Engine MCP** sidebar panel (cloud icon in the Activity Bar).

- Paste your IBM Cloud API key and click **Save**
- The key is stored in VS Code SecretStorage — never in plaintext in a file
- This key is for a server on **this machine**. The extension passes it to that process; it is not written into the IDE config when you use the default shared HTTP server.

**How the local server runs** (Setup → Server connection → This computer, setting `codeEngineMcp.localTransport`):

- **Shared HTTP server** (default): the extension starts one server on `127.0.0.1` and chat, the IDE MCP list, the web UI (`/admin`) and MCP Remote Config all use that one process, so the audit trace, logging, users, keys and settings line up. If another VS Code window already runs it, the extension reuses it, and if the window that owns it closes, another open window starts it again within 30 seconds. The server is not running while no VS Code window is open.
- **stdio**: each IDE window starts its own private process. The web UI then shows a different process than the one your IDE talks to.

### 3. Configure the MCP server

Click **Configure MCP** in the sidebar. This writes the `code-engine` entry for VS Code, Cursor, Bob, Windsurf, Cline, Antigravity, and Claude Desktop (other servers in those files are kept) and opens the VS Code MCP Servers panel. It writes the same connection the extension uses, replacing the entry in place. Change the transport or port and the extension offers to update the files again.

With the shared HTTP server (default) the VS Code entry points at the local server and carries the local login (`admin` plus the password from `codeEngineMcp.localAdminPassword`, default `admin`; it only works on `127.0.0.1`):

```json
{
  "servers": {
    "code-engine": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Basic ..." }
    }
  }
}
```

With **stdio** it starts the server the extension runs (the bundled one, a newer pulled npm build, or `npx` when Install method is `npx`). The VS Code entry looks like this:

```json
{
  "servers": {
    "code-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": {
        "IBMCLOUD_API_KEY": "...",
        "IBMCLOUD_REGION": "us-south"
      }
    }
  }
}
```

### Shared server: the MCP process holds the IBM Cloud key

Use this when other programs should call Code Engine without receiving the IBM Cloud key.

1. Run `code-engine-mcp-server` with `MCP_MODE=http`.
2. Put the IBM Cloud key on that server once: the admin page, or `server_settings` action `secrets` with `ibmcloud_api_key`. The value is saved for that process and is never returned.
3. Create callers on that same server:
   - a user, with `server_users` action `create` (username, password, and scopes `read`, `write`, and/or `admin`)
   - or an MCP API key, with `server_api_keys` action `issue` (the secret is shown once and starts with `cemcp_`)
4. Point each program at `https://your-server/mcp` and send one of these headers:
   - `Authorization: Basic` with that username and password
   - `Authorization: Bearer` with the issued MCP API key

The server calls IBM Cloud with the key from step 2. The user or the MCP API key only decides which tools that program may call. An IDE that should use the shared server does **not** get `IBMCLOUD_API_KEY` in its MCP config. **Configure MCP** in this extension writes the local process only.

```json
{
  "mcpServers": {
    "code-engine": {
      "url": "https://your-server.example/mcp",
      "headers": { "Authorization": "Bearer cemcp_..." }
    }
  }
}
```

### 4. Run Diagnostics

Click **Run Diagnostics** to verify:
- ✅ Node.js is found on PATH
- ✅ API key is configured
- ✅ MCP server is registered in `mcp.json`
- ✅ Tool list is discovered from the running server (the heading shows the count, for example **Discovered Tools (28)**)

### 5. Optional: Provenance Receipt Visualizer

If you use the [provenance addon](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/provenance-addon) (`PROVENANCE_ENABLED=true`), open **Receipt Visualizer (Optional)** from the sidebar **Resources & Docs** section (or Command Palette → **Open Optional Receipt Visualizer**).

The panel loads receipts from `provenance-addon/receipts/live/` on open. **Live refresh** is optional (off by default) — toggle it in the panel header or set `codeEngineMcp.provenanceLiveRefresh` in settings. Use **↻ Reload** for a manual refresh.

**You need:** clone [code-engine-mcp-server](https://github.com/markusvankempen/code-engine-mcp-server) (or open it in your workspace) and at least one signed receipt on disk.

**Browser (no extension):** from a [provenance-addon](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/provenance-addon) clone, run `npm run serve:visualizer` then enable **Live refresh** at `http://localhost:8766/visualizer.html`.

### 6. MCP Activity Dashboard (v1.4.0)

Command Palette → **IBM Code Engine MCP: Open MCP Activity Dashboard**.

The panel shows:

- **Activity tab** — session selector, tool-call timeline, idle gaps, task-outcome banner (status, image, live URL)
- **Deployments tab** — Code Engine project/app inventory with get-details, redeploy, and delete actions

It is also in the sidebar as **MCP Activity** (collapsed by default), and the **MCP Activity Dashboard** button in Setup & Diagnostics opens it.

**Logging is on by default** (`codeEngineMcp.activityEnabled`). Every tool call is written to `~/.code-engine-mcp/activity/events.jsonl` with secrets redacted, and the file rotates at 5 MB. **Live refresh** is on by default too (`codeEngineMcp.activityLiveRefresh`).

Servers started outside the extension (Cursor, Bob, Claude Desktop, and so on) log to the same file unless `MCP_ACTIVITY_ENABLED=false` or a different `MCP_ACTIVITY_EVENTS_PATH` is set.

**Browser (standalone):** the extension dashboard is the recommended path. If your workspace includes `dashboard/` (full server source), run `npm run dashboard` → http://localhost:8767/

---

## Quick start examples

The **Quick Start** tab in the sidebar has ready-to-use prompts. Here are a few highlights:

### 🔍 Discover your environment
> *"List all my Code Engine projects and then show me all the running apps in each project."*

### 🚀 Developer Splash Page — one-shot deploy

Example: [examples/developer-splash](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/examples/developer-splash)
> *"I have an app in the examples/developer-splash folder. Please build it for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first. Let me know when it's live!"*

Or step by step:
1. *"Can you validate the Dockerfile in examples/developer-splash to ensure it's compatible with Code Engine?"*
2. *"Please build the examples/developer-splash app and push it to my IBM Container Registry."*
3. *"Deploy the developer-splash image to my Code Engine project. Check if I have a registry pull secret first, and create one if needed."*

### ⭐ Star Wars Splash Page — one-shot deploy

Example: [examples/starwars-splash](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/examples/starwars-splash)
> *"I have a Star Wars splash page in examples/starwars-splash. Please build it for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first. Let me know when it's live!"*

---

## Settings reference

| Setting | Required | Default | Purpose |
|---|---|---|---|
| `codeEngineMcp.apiKey` | Deprecated | `""` | Deprecated. The key is entered in the sidebar and kept in VS Code SecretStorage; a value found here is migrated |
| `codeEngineMcp.region` | No | `us-south` | IBM Cloud region |
| `codeEngineMcp.serverMode` | No | `local` | `local` runs the server on this machine; `remote` uses the URL in `remoteUrl` (also set under Setup → Server connection) |
| `codeEngineMcp.localTransport` | No | `http` | How the local server runs: `http` (one shared server for chat, the IDE MCP list, the web UI and MCP Remote Config) or `stdio` (each IDE window starts its own process) |
| `codeEngineMcp.localHttpPort` | No | `8787` | Port of the shared local HTTP server (bound to `127.0.0.1` only) |
| `codeEngineMcp.localAdminPassword` | No | `admin` | Password of the shared local server (user `admin`). Empty = generate one and keep it in SecretStorage |
| `codeEngineMcp.remoteUrl` | When `serverMode` is `remote` | `""` | URL of a shared code-engine MCP server, for example `https://my-server.example/mcp` |
| `codeEngineMcp.installMethod` | No | `bundled` | `bundled` (server shipped with the extension; npm check can replace it) or `npx` (always `code-engine-mcp-server@latest`) |
| `codeEngineMcp.checkNpmUpdates` | No | `true` | On startup, offer to pull a newer `code-engine-mcp-server` from npm when one is newer than the bundled (or previously pulled) server |
| `codeEngineMcp.activityEnabled` | No | `true` | Log every MCP tool call to `~/.code-engine-mcp/activity/events.jsonl` |
| `codeEngineMcp.activityLiveRefresh` | No | `true` | Watch `events.jsonl` and auto-reload the Activity Dashboard |
| `codeEngineMcp.provenanceLiveRefresh` | No | `false` | Watch provenance receipts and auto-reload the Receipt Visualizer |

---

## Troubleshooting

**"Cannot find module 'ajv'"**  
Run diagnostics — if Node.js v24+ is in use, the bundled server handles this. The extension and npm package share the same version (`1.7.8`). `npx` mode uses `code-engine-mcp-server@latest`.

**MCP server not appearing in Copilot**  
Click **Configure MCP** in the sidebar. This writes `code-engine` into VS Code, Cursor, Bob, Windsurf, Cline, Antigravity, and Claude Desktop configs (other servers are kept) and reloads the VS Code server list.

**Diagnostics shows tools but AI assistant can't use them**  
Reload VS Code window (`Cmd+Shift+P` → **Reload Window**) after configuring MCP for the first time.

**Activity Dashboard shows no sessions / no live updates**  
1. Confirm `codeEngineMcp.activityEnabled` is on and the MCP server env does not set `MCP_ACTIVITY_ENABLED=false` or a different `MCP_ACTIVITY_EVENTS_PATH`.  
2. Restart the MCP server (Cursor MCP panel → restart `code-engine`).  
3. Click **Show all activity** if you previously clicked **Clear view**.  
4. Open the [public repo](https://github.com/markusvankempen/code-engine-mcp-server) (or a local clone) so the extension can find `dashboard/activity/live/events.jsonl` if you use a custom events path.

---

## Repository

Public repo: [github.com/markusvankempen/code-engine-mcp-server](https://github.com/markusvankempen/code-engine-mcp-server)

Key docs on GitHub:
- [Setup Instructions](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/docs/SETUP_INSTRUCTIONS.md)
- [Tool reference (28 tools)](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/docs/TOOLS.md)
- [Connect to a remote or shared server](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/docs/REMOTE_MCP_CONNECTION.md)
- [Main README](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/README.md)
- [Provenance addon](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/provenance-addon)
- [Examples](https://github.com/markusvankempen/code-engine-mcp-server/tree/main/examples)

---

## Development

```bash
cd vscode-extension
npm install
npm run compile
# Press F5 to open an Extension Development Host
```

```bash
npm run package        # produces code-engine-mcp-<version>.vsix (matches package.json)
```
