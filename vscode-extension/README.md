# IBM Code Engine MCP — VS Code Extension

> **v1.4.0** — Same release as `code-engine-mcp-server@1.4.0`: MCP Activity Dashboard, live MCP activity logging, Deployments tab, provenance visualizer updates, ICR login fix in `proc_build_push_deploy`, `write_or_modify_file` tool

Deploy containerised apps to **IBM Code Engine** using natural language. This extension wires up the `code-engine-mcp-server` as an [MCP](https://modelcontextprotocol.io) server so any AI assistant running in your IDE (GitHub Copilot, Cline, Cursor, etc.) can build images, push them to IBM Container Registry, and deploy apps — all from a chat prompt.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=MarkusvanKempen.code-engine-mcp)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Registry-C160EF?logo=eclipseide&logoColor=white)](https://open-vsx.org/extension/markusvankempen/code-engine-mcp)
[![npm](https://img.shields.io/badge/npm-code--engine--mcp--server-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/code-engine-mcp-server)

---

## What can it do?

Once configured, you can talk to your AI assistant and say things like:

> *"List all my Code Engine projects and show me all the running apps in each project."*

> *"Build my app for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first."*

> *"Deploy the developer-splash image to my Code Engine project. Check if I have a registry pull secret first, and create one if needed."*

The assistant calls the MCP tools behind the scenes — no CLI commands to remember.

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
- The key is stored in VS Code global settings — never in plaintext in a file

### 3. Configure the MCP server

Click **Configure MCP** in the sidebar. This writes the server entry to `mcp.json` (VS Code's global MCP config) and opens the MCP Servers panel so VS Code registers it:

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

### 4. Run Diagnostics

Click **Run Diagnostics** to verify:
- ✅ Node.js is found on PATH
- ✅ API key is configured
- ✅ MCP server is registered in `mcp.json`
- ✅ Tool list is discovered from the running server

### 5. Optional: Provenance Receipt Visualizer

If you use the [provenance addon](../provenance-addon/) (`PROVENANCE_ENABLED=true`), open **Receipt Visualizer (Optional)** from the sidebar **Resources & Docs** section (or Command Palette → **Open Optional Receipt Visualizer**).

The panel loads receipts from `provenance-addon/receipts/live/` on open. **Live refresh** is optional (off by default) — toggle it in the panel header or set `codeEngineMcp.provenanceLiveRefresh` in settings. Use **↻ Reload** for a manual refresh.

**You need:** the workspace folder open (e.g. `code-engine` repo root) and at least one signed receipt on disk.

**Browser (no extension):** `cd provenance-addon && npm run serve:visualizer` then enable **Live refresh** at `http://localhost:8766/visualizer.html`.

---

## Quick start examples

The **Quick Start** tab in the sidebar has ready-to-use prompts. Here are a few highlights:

### 🔍 Discover your environment
> *"List all my Code Engine projects and then show me all the running apps in each project."*

### 🚀 Developer Splash Page — one-shot deploy
> *"I have an app in the examples/developer-splash folder. Please build it for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first. Let me know when it's live!"*

Or step by step:
1. *"Can you validate the Dockerfile in examples/developer-splash to ensure it's compatible with Code Engine?"*
2. *"Please build the examples/developer-splash app and push it to my IBM Container Registry."*
3. *"Deploy the developer-splash image to my Code Engine project. Check if I have a registry pull secret first, and create one if needed."*

### ⭐ Star Wars Splash Page — one-shot deploy
> *"I have a Star Wars splash page in examples/starwars-splash. Please build it for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first. Let me know when it's live!"*

---

## Settings reference

| Setting | Required | Default | Purpose |
|---|---|---|---|
| `codeEngineMcp.apiKey` | Yes | `""` | IBM Cloud API key |
| `codeEngineMcp.region` | No | `us-south` | IBM Cloud region |
| `codeEngineMcp.installMethod` | No | `bundled` | `bundled` (uses server shipped with extension) or `npx` (always pulls latest from npm) |

---

## Troubleshooting

**"Cannot find module 'ajv'"**  
Run diagnostics — if Node.js v24+ is in use, the bundled server handles this. If using `npx` mode, ensure you're on `code-engine-mcp-server@1.4.0` (extension and npm package share the same version).

**MCP server not appearing in Copilot**  
Click **Configure MCP** in the sidebar. This writes the entry to `~/Library/Application Support/Code/User/mcp.json` (macOS) and reloads the server list.

**Diagnostics shows tools but AI assistant can't use them**  
Reload VS Code window (`Cmd+Shift+P` → **Reload Window**) after configuring MCP for the first time.

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
