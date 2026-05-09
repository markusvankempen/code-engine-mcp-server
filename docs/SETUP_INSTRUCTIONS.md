# Setup Instructions for MCP Clients (VS Code, Antigravity, Bob, Cursor)

Follow these steps to enable your AI assistant to understand Docker and Code Engine commands across different IDEs and MCP clients.

---

## 🏗️ Step 1: Verify the Build

The MCP server must be built before it can be used. Verify it exists:

```bash
ls -la /Users/markusvankempen/projects/code-engine/code-engine-mcp-server/build/index.js
```

If it doesn't exist, run `npm install && npm run build` in the server root.

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
         "command": "node",
         "args": ["/Users/markusvankempen/projects/code-engine/code-engine-mcp-server/build/index.js"],
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
       "command": "node",
       "args": ["/Users/markusvankempen/projects/code-engine/code-engine-mcp-server/build/index.js"],
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
5. **Command**: `node /Users/markusvankempen/projects/code-engine/code-engine-mcp-server/build/index.js`
6. **Environment Variables**: Add `IBMCLOUD_API_KEY` with your key value.

---

## 🚀 Step 3: Verify the Connection

Once configured, restart your IDE or reload the MCP server and test with a simple prompt:

> "Can you detect which container runtime I have installed?"

The assistant should respond with your Docker or Podman version information.

---

## 🤖 Step 4: The Agentic Experience (No Docker/Code Engine Lingo Needed)

The true power of this MCP server is that **you don't need to know Docker or Code Engine commands**. You can simply state your goal, and the LLM will discover the environment, run the pipeline, and fix issues autonomously. 

Here is an example interaction from a real session:

**User:**
> "I have an app in the `developer-splash` folder. Deploy it to my Code Engine project."

**Assistant's Autonomous Thought Process:**
1. *Discovery:* "Let me check what projects and namespaces exist... Found project `markus-app-v2-toronto` and namespace `mvk-code-engine`."
2. *Prerequisites:* "No pull secret in this project yet. I'll get the API key from the `.env` file and create the secret `icr-pull-secret`."
3. *Execution:* "Now I'll run the full pipeline: build → push → deploy → wait."
4. *Validation:* "It's deployed but stuck at 'deploying'. Let me check the logs... The container is running but the readiness probe is failing."
5. *Self-Correction:* "Ah, the `sed` pattern in the Dockerfile didn't match nginx alpine's default config format for port 80. I'll fix the Dockerfile with a regex-safe `sed` and rebuild."
6. *Completion:* "App is live! 🎉 Status: ready."

**Assistant Response to User:**
> "Your app is deployed and live at: `https://developer-splash.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud`. I had to fix a minor port configuration issue in your Dockerfile, but it is successfully running now!"

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