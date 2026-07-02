# Setup Instructions for MCP Clients

Follow these steps to connect any AI assistant to IBM Code Engine and Docker/Podman via the MCP server.

---

## 🔑 Step 1: Get an IBM Cloud API key

All Code Engine and ICR operations require an IBM Cloud API key.

1. Go to **[IBM Cloud IAM → API keys](https://cloud.ibm.com/iam/apikeys)**
2. Click **Create an IBM Cloud API key**
3. Give it a name (e.g. `code-engine-mcp`) and copy the value — you won't see it again

Keep it in a password manager. You'll use it in one of the options below.

---

## 🔐 Step 2: Decide how to store the API key

Never paste your API key directly into a file you might commit to git. Three options are available — choose one and use it consistently across all client configs below.

### Option A — Shell environment variable (most secure, recommended)

Copy the template and fill in your key:

```bash
# from the repo root
cp .env.example .env        # .env is already in .gitignore
```

Edit `.env`:
```
IBMCLOUD_API_KEY=your-ibm-cloud-api-key-here
```

Load it into your current shell (or add the `export` line to `~/.zshrc` / `~/.bash_profile` for permanence):

```bash
source .env
# or permanently:
echo 'export IBMCLOUD_API_KEY="your-key"' >> ~/.zshrc
```

In any MCP config file, reference it without embedding the value:
```json
"IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}"
```

> `${env:VARIABLE}` is VS Code's input-substitution syntax — it reads the value from your shell environment when the server starts. The key never appears in the config file.

---

### Option B — VS Code input variable (prompted on connect)

VS Code can ask you for the key each time it starts the MCP server. Good for shared or public machines.

Add an `inputs` block at the top level of your `mcp.json` (or `.vscode/mcp.json`):

```json
{
  "inputs": [
    {
      "id": "ibmcloud-api-key",
      "type": "promptString",
      "description": "IBM Cloud API key",
      "password": true
    }
  ],
  "servers": {
    "code-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": {
        "IBMCLOUD_API_KEY": "${input:ibmcloud-api-key}",
        "IBMCLOUD_REGION": "us-south"
      }
    }
  }
}
```

VS Code shows a masked password prompt when the server starts. The key is never written to disk.

---

### Option C — Inline value (simplest, least secure)

Paste the key directly into the config. Only do this on a personal machine and make sure the file is in `.gitignore`.

```json
"IBMCLOUD_API_KEY": "your-ibm-cloud-api-key-here"
```

> **Security:** Add the config file to `.gitignore` and never commit it. Prefer Option A or B whenever possible.

---

## ⚙️ Step 3: Configure your client

Choose your IDE or client below. Each config uses the `${env:IBMCLOUD_API_KEY}` pattern (Option A). Swap in the Option B or C value if you prefer one of those approaches.

---

### 1. VS Code + GitHub Copilot — extension (easiest)

The official extension handles server startup, API key storage, and MCP registration automatically — no `mcp.json` editing required.

| Platform | Install |
|---|---|
| VS Code Marketplace | [MarkusvanKempen.code-engine-mcp](https://marketplace.visualstudio.com/items?itemName=MarkusvanKempen.code-engine-mcp) |
| Open VSX (Cursor / Theia / Gitpod / Codium) | [markusvankempen.code-engine-mcp](https://open-vsx.org/extension/markusvankempen/code-engine-mcp) |

After installing:

1. Open the **IBM Code Engine MCP** sidebar panel (cloud icon in the Activity Bar)
2. Paste your IBM Cloud API key and click **Save**
3. Click **Configure MCP** — writes the server entry to the global `mcp.json`
4. Click **Run Diagnostics** to confirm Node.js, the API key, and tool discovery are all ✅

> The extension stores the key in VS Code global settings — encrypted by the OS keychain, never in a plaintext file.

---

### 2. VS Code + GitHub Copilot — manual `mcp.json`

Use this if you prefer to manage the config yourself without the extension.

Create (or edit) `.vscode/mcp.json` in your workspace root, or the global config at `~/Library/Application Support/Code/User/mcp.json` (macOS):

```bash
# workspace-level (add to .gitignore)
mkdir -p .vscode
echo '.vscode/mcp.json' >> .gitignore
```

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

Restart the server after saving: **Cmd+Shift+P** → **MCP: Restart Server** → `code-engine`.

---

### 3. Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-engine": {
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

> Claude Desktop does not support `${env:...}` substitution — use Option A (export the variable in your shell profile before launching Claude) or Option C (inline, with the file excluded from git).

Restart Claude Desktop after saving.

---

### 4. Cline (VS Code Extension)

1. Open **VS Code Settings** (`Cmd+,`)
2. Search for **Cline: MCP Settings** → **Edit in settings.json**
3. Add:

```json
{
  "cline.mcpServers": {
    "code-engine": {
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

> If your shell exports `IBMCLOUD_API_KEY`, Cline inherits it automatically — the `${env:...}` reference will resolve without any extra config.

---

### 5. Cursor IDE

Cursor supports MCP servers in its settings UI or via a `~/.cursor/mcp.json` file.

**UI approach:**
1. Go to **Cursor Settings** → **General** → **MCP**
2. Click **+ Add New MCP Server**
3. Fill in:
   - **Name**: `code-engine`
   - **Type**: `stdio`
   - **Command**: `npx`
   - **Args**: `-y code-engine-mcp-server@latest`
   - **Environment Variables**: `IBMCLOUD_API_KEY` = your key value

**File approach** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "code-engine": {
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

Cursor also supports the Open VSX extension: [markusvankempen.code-engine-mcp](https://open-vsx.org/extension/markusvankempen/code-engine-mcp)

---

## 🚀 Step 4: Verify the connection

Once configured, restart your IDE or reload the MCP server and test with:

> *"Can you detect which container runtime I have installed?"*

The assistant should respond with your Docker or Podman version. If it fails, see the Troubleshooting section below.

---

## 🤖 Step 5: The agentic experience

You don't need to know Docker or Code Engine commands. State your goal and the AI handles discovery, execution, and self-correction autonomously.

**Example from a real session:**

**User:** *"I have an app in the `developer-splash` folder. Deploy it to my Code Engine project."*

**Assistant's thought process:**
1. *Discovery:* "Let me check what projects and namespaces exist… Found project `markus-app-v2-toronto` and namespace `mvk-code-engine`."
2. *Prerequisites:* "No pull secret in this project yet. I'll create `icr-pull-secret` using the current API key."
3. *Execution:* "Running the full pipeline: build → push → deploy → wait."
4. *Validation:* "Stuck at 'deploying'. Checking logs… readiness probe failing."
5. *Self-correction:* "The `sed` pattern in the Dockerfile used `\s*` which Alpine BusyBox doesn't support. Fixing to `[[:space:]]*` and rebuilding."
6. *Completion:* "App is live! Status: ready."

**Response to user:** *"Your app is deployed at `https://developer-splash.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud`. I fixed a minor port config issue in the Dockerfile along the way."*

---

## 🛠️ Troubleshooting

### `IBMCLOUD_API_KEY` not set / `401 Unauthorized`

The server requires the key at startup. Verify it is exported in the shell that launches your IDE:

```bash
echo $IBMCLOUD_API_KEY    # should print your key, not empty
```

If empty, run `source .env` (from the repo root after filling in `.env`) or add the export to your shell profile.

### Tools show `undefined` or AI can't use them

Run **Diagnostics** (extension sidebar) or check `tools/list` in the [MCP Inspector](https://github.com/modelcontextprotocol/inspector). If the tool list is empty, the server exited at startup — run `node build/index.js` directly to see any error output.

### `Cannot find module` / `MODULE_NOT_FOUND`

Use `npx -y code-engine-mcp-server@latest` instead of a local path, or ensure the repo is built with `npm install && npm run build` and use the absolute path to `build/index.js`.

### Port / permission errors on macOS

If `npx` can't find Node.js, ensure `node` and `npx` are on your `PATH`:

```bash
node --version   # must be ≥ 18
npx --version
```

Install from [nodejs.org](https://nodejs.org) if missing.

### App revision stuck in `no_revision_ready`

See [MCP Inspector Troubleshooting](https://github.com/markusvankempen/code-engine-mcp-server/blob/main/docs/MCP_INSPECTOR_TROUBLESHOOTING.md) — the two most common causes are a stale ICR pull secret and an nginx port not rewritten in the Dockerfile.

### Activity Dashboard shows no sessions

The dashboard reads `dashboard/activity/live/events.jsonl`, which is only written when the MCP server starts with activity logging enabled.

1. Add to MCP server env and restart the server:

```json
"MCP_ACTIVITY_ENABLED": "true",
"MCP_ACTIVITY_EVENTS_PATH": "/absolute/path/to/code-engine-mcp-server/dashboard/activity/live/events.jsonl"
```

2. Open the dashboard: extension → **Open MCP Activity Dashboard**, or `npm run dashboard` → http://localhost:8767/
3. If you cleared the view, click **Show all activity** to restore older sessions.

Optional labels for the session dropdown:

```json
"MCP_ACTIVITY_SESSION_ID": "session:deploy-demo",
"MCP_ACTIVITY_CHAT_LABEL": "Star Wars splash deploy"
```

---

## 🔐 Security checklist

- [ ] `.env` is in `.gitignore` (already set in this repo — verify with `git check-ignore .env`)
- [ ] `.vscode/mcp.json` is in `.gitignore` if it contains inline credentials
- [ ] API key uses `${env:IBMCLOUD_API_KEY}` or `${input:...}` rather than an inline value
- [ ] API key has only the minimum required IAM permissions (Code Engine Editor + Container Registry Reader)
