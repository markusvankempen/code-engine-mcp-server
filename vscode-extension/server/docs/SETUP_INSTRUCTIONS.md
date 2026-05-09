# Setup Instructions for MCP Clients (VS Code, Antigravity, Bob, Cursor)

Follow these steps to enable your AI assistant to understand Docker and Code Engine commands across different IDEs and MCP clients.

---

## 🏗️ Step 1: Verify the Package

The MCP server is published to npm and runs via `npx` — no local build or clone required. Verify the package is accessible:

```bash
npx -y code-engine-mcp-server@latest --version
```

If you prefer a local install: `npm install -g code-engine-mcp-server`

---

## ⚙️ Step 2: Configure Your Client

Choose your IDE/Client below and follow the specific configuration steps.

### 1. VS Code + GitHub Copilot (Official Extension)
If you are using the latest VS Code (**1.101+**) with GitHub Copilot, the easiest way is to use our pre-built extension:
1. Go to the `vscode-extension/` folder in this repo.
2. Install the `.vsix` file (**Command Palette** → **Extensions: Install from VSIX...**).
3. Open **Settings** (**Cmd+,**) and search for **IBM Code Engine MCP**.
4. Enter your **IBM Cloud API Key**.

### 2. Antigravity IDE / Claude Desktop
Antigravity uses a standard MCP configuration file.
1. Open (or create) your MCP config file at:
   `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the following entry:
   ```json
   {
     "mcpServers": {
       "code-engine": {
         "command": "npx",
         "args": ["-y", "code-engine-mcp-server@latest"],
         "env": {
           "IBMCLOUD_API_KEY": "YOUR_IBM_CLOUD_API_KEY",
           "IBMCLOUD_REGION": "us-south"
         }
       }
     }
   }
   ```

### 3. Bob / Cline (VS Code Extension)
1. Open **VS Code Settings** and search for **Cline: MCP Settings**.
2. Click **Edit in settings.json**.
3. Add the server to the `cline.mcpServers` object:
   ```json
   "cline.mcpServers": {
     "code-engine": {
       "command": "npx",
       "args": ["-y", "code-engine-mcp-server@latest"],
       "env": {
         "IBMCLOUD_API_KEY": "YOUR_IBM_CLOUD_API_KEY"
       }
     }
   }
   ```

### 4. Cursor IDE
Cursor supports MCP servers directly in its settings.
1. Go to **Cursor Settings** → **General** → **MCP**.
2. Click **+ Add New MCP Server**.
3. **Name**: `code-engine`
4. **Type**: `stdio`
5. **Command**: `npx -y code-engine-mcp-server@latest`
6. **Environment Variables**: Add `IBMCLOUD_API_KEY` with your key value.

---

## 🚀 Step 3: Verify the Connection

Once configured, restart your IDE or reload the MCP server and test with a simple prompt:

> "Can you detect which container runtime I have installed?"

The assistant should respond with your Docker or Podman version information.

---

## 🛠️ Troubleshooting

### "Cannot find module" or "MODULE_NOT_FOUND"
Ensure you are using an **absolute path** in the `args` or `command` field. MCP clients usually do not resolve `${workspaceFolder}` or `~` correctly.

### "invalid character 'â'" or encoding errors
Ensure your server is built using `npm run build`. This error often occurs if there are special characters in the source code that the `stdio` transport cannot handle.

### IBM Cloud API Key
Get your key from: [https://cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys). Ensure it has the necessary permissions for Code Engine and Container Registry.

---

## 🔐 Security Note
⚠️ **Important**: Never commit your `mcp_config.json` or any file containing your API key to version control. Always use `.gitignore` to protect your secrets.