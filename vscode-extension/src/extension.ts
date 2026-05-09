import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function listMcpTools(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Server timed out (10s). Is Node.js working and the server valid?"));
    }, 10000);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    // Send MCP initialize then tools/list
    const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diagnostics", version: "1.0" } } }) + "\n";
    const toolsList = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n";
    child.stdin.write(initialize);
    child.stdin.write(toolsList);

    // Parse responses as they arrive
    let responded = false;
    child.stdout.on("data", () => {
      const lines = stdout.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            responded = true;
            clearTimeout(timer);
            child.kill();
            resolve((msg.result.tools as Array<{ name: string }>).map(t => t.name));
            return;
          }
        } catch { /* incomplete JSON line, keep buffering */ }
      }
    });

    child.on("close", () => {
      clearTimeout(timer);
      if (!responded) {
        // Try parsing full buffered stdout as newline-delimited JSON
        const lines = stdout.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === 2 && msg.result?.tools) {
              resolve((msg.result.tools as Array<{ name: string }>).map(t => t.name));
              return;
            }
          } catch { /* skip */ }
        }
        reject(new Error(stderr || "Server exited without returning tools."));
      }
    });
  });
}

function getMcpJsonPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "mcp.json");
  } else if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  } else {
    return path.join(home, ".config", "Code", "User", "mcp.json");
  }
}

function readMcpJson(): any {
  const p = getMcpJsonPath();
  if (!fs.existsSync(p)) return { servers: {} };
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return { servers: {} }; }
}

type McpServerDefinition = {
  label?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export function activate(context: vscode.ExtensionContext): void {
  const lm = (vscode as any).lm;
  if (!lm?.registerMcpServerDefinitionProvider) {
    console.warn("VS Code MCP API is unavailable. Requires VS Code 1.101+.");
  }

  const onDidChangeEmitter = new vscode.EventEmitter<void>();

  const provider = {
    onDidChangeMcpServerDefinitions: onDidChangeEmitter.event,
    provideMcpServerDefinitions: async (): Promise<McpServerDefinition[]> => {
      const config = vscode.workspace.getConfiguration("codeEngineMcp");
      const apiKey = String(config.get("apiKey", "")).trim();
      const region = String(config.get("region", "us-south")).trim() || "us-south";
      const installMethod = String(config.get("installMethod", "bundled"));

      if (!apiKey) {
        return [];
      }

      const serverDef: McpServerDefinition = {
        label: "IBM Code Engine MCP",
        command: "node",
        args: [],
        env: {
          IBMCLOUD_API_KEY: apiKey,
          IBMCLOUD_REGION: region,
        },
      };

      if (installMethod === "npx") {
        serverDef.command = "npx";
        serverDef.args = ["-y", "code-engine-mcp-server"];
      } else {
        const serverPath = vscode.Uri.joinPath(context.extensionUri, "server", "index.js").fsPath;
        serverDef.command = "node";
        serverDef.args = [serverPath];
      }

      return [serverDef];
    },
  };

  if (lm?.registerMcpServerDefinitionProvider) {
    const registration = lm.registerMcpServerDefinitionProvider("code-engine-mcp-provider", provider);
    context.subscriptions.push(registration);
  }
  
  context.subscriptions.push(onDidChangeEmitter);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("codeEngineMcp.apiKey") ||
        event.affectsConfiguration("codeEngineMcp.region") ||
        event.affectsConfiguration("codeEngineMcp.installMethod")
      ) {
        onDidChangeEmitter.fire();
      }
    })
  );

  // Diagnostic Webview Command
  context.subscriptions.push(
    vscode.commands.registerCommand("codeEngineMcp.runDiagnostics", () => {
      const panel = vscode.window.createWebviewPanel(
        "ceMcpDiagnostics",
        "IBM Code Engine MCP Diagnostics",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      const htmlPath = vscode.Uri.file(path.join(context.extensionPath, "media", "diagnostics.html"));
      panel.webview.html = fs.readFileSync(htmlPath.fsPath, "utf8");

      setupWebviewMessages(panel.webview, context, onDidChangeEmitter);
    })
  );

  // Sidebar View Provider
  const sidebarProvider = new CodeEngineSidebarProvider(context, onDidChangeEmitter);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codeEngineMcpSetup", sidebarProvider)
  );
}

class CodeEngineSidebarProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDidChangeEmitter: vscode.EventEmitter<void>
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    const htmlPath = vscode.Uri.file(path.join(this.context.extensionPath, "media", "diagnostics.html"));
    webviewView.webview.html = fs.readFileSync(htmlPath.fsPath, "utf8");
    setupWebviewMessages(webviewView.webview, this.context, this.onDidChangeEmitter);
  }
}

function getMcpStatusHtml(mcpJson: any): string {
  if (mcpJson.servers?.["code-engine"]) {
    return `<span class="status-dot ok"></span>MCP server registered in mcp.json`;
  }
  return `<span class="status-dot warn"></span>Not configured — click Configure MCP`;
}

function setupWebviewMessages(webview: vscode.Webview, context: vscode.ExtensionContext, onDidChangeEmitter: vscode.EventEmitter<void>) {
  webview.onDidReceiveMessage(async (message) => {
    const config = vscode.workspace.getConfiguration("codeEngineMcp");

    if (message.command === "requestInitialState") {
      const currentKey = String(config.get("apiKey", "")).trim();
      webview.postMessage({ command: "initialState", hasKey: currentKey.length > 0 });
      webview.postMessage({ command: "mcpConfigStatus", html: getMcpStatusHtml(readMcpJson()) });
    } else if (message.command === "openSettings") {
      vscode.commands.executeCommand("workbench.action.openSettings", "IBM Code Engine MCP");
    } else if (message.command === "openExtensionPage") {
      vscode.commands.executeCommand("extension.open", "markusvankempen.code-engine-mcp");
    } else if (message.command === "openReadme") {
      vscode.env.openExternal(vscode.Uri.parse("https://github.com/markusvankempen/code-engine-mcp-server#readme"));
    } else if (message.command === "configureMcp") {
      const apiKey = String(config.get("apiKey", "")).trim();
      if (!apiKey) {
        webview.postMessage({ command: "log", text: "Configure MCP failed: API Key not set. Save your key first." });
        webview.postMessage({ command: "mcpConfigStatus", html: `<span class="status-dot err"></span>API Key required — save it first` });
        return;
      }
      const region = String(config.get("region", "us-south")).trim() || "us-south";
      const mcpPath = getMcpJsonPath();
      try {
        const mcpJson = readMcpJson();
        if (!mcpJson.servers) mcpJson.servers = {};
        mcpJson.servers["code-engine"] = {
          type: "stdio",
          command: "npx",
          args: ["-y", "code-engine-mcp-server@latest"],
          env: { IBMCLOUD_API_KEY: apiKey, IBMCLOUD_REGION: region },
        };
        fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
        fs.writeFileSync(mcpPath, JSON.stringify(mcpJson, null, 2));
        onDidChangeEmitter.fire();
        webview.postMessage({ command: "log", text: `MCP server written to ${mcpPath}` });
        webview.postMessage({ command: "mcpConfigStatus", html: `<span class="status-dot ok"></span>MCP server registered in mcp.json` });
        vscode.commands.executeCommand("workbench.action.chat.manageMcpServers");
      } catch (e) {
        webview.postMessage({ command: "log", text: `Configure MCP failed: ${(e as Error).message}` });
        webview.postMessage({ command: "mcpConfigStatus", html: `<span class="status-dot err"></span>Failed: ${(e as Error).message}` });
      }
    } else if (message.command === "openDoc") {
      const docUri = vscode.Uri.joinPath(context.extensionUri, "server", "docs", message.file);
      vscode.commands.executeCommand("markdown.showPreview", docUri);
    } else if (message.command === "openExample") {
      const exUri = vscode.Uri.joinPath(context.extensionUri, "examples", message.file);
      vscode.commands.executeCommand("markdown.showPreview", exUri);
    } else if (message.command === "sendPrompt") {
      vscode.commands.executeCommand("workbench.action.chat.open", { query: message.prompt });
    } else if (message.command === "saveApiKey") {
      try {
        await config.update("apiKey", message.key, vscode.ConfigurationTarget.Global);
        webview.postMessage({ command: "log", text: "API Key saved to global settings successfully." });
      } catch (e) {
        webview.postMessage({ command: "log", text: "Failed to save API Key: " + (e as Error).message });
      }
    } else if (message.command === "runDiagnostics") {
      // Check Node.js
      try {
        const { stdout } = await execAsync("node --version");
        webview.postMessage({
          command: "systemStatus",
          html: `<span class="status-dot ok"></span>Node.js found: ${stdout.trim()}`,
        });
      } catch {
        webview.postMessage({
          command: "systemStatus",
          html: `<span class="status-dot err"></span>Node.js not found in PATH`,
        });
      }

      // Check API Key
      const apiKey = String(config.get("apiKey", "")).trim();
      if (apiKey) {
        webview.postMessage({
          command: "configStatus",
          html: `<span class="status-dot ok"></span>API Key is configured (Length: ${apiKey.length})`,
        });

        // Discovery Tools
        webview.postMessage({ command: "log", text: "Starting tool discovery..." });
        try {
          const installMethod = String(config.get("installMethod", "bundled"));
          let command: string;
          let args: string[];
          if (installMethod === "npx") {
            command = "npx";
            args = ["-y", "code-engine-mcp-server"];
          } else {
            const serverPath = vscode.Uri.joinPath(context.extensionUri, "server", "index.js").fsPath;
            command = "node";
            args = [serverPath];
          }

          const tools = await listMcpTools(command, args, { ...process.env, IBMCLOUD_API_KEY: apiKey });
          if (tools.length > 0) {
            const toolHtml = tools.map((t) => `<span class="tool-tag">${t}</span>`).join("");
            webview.postMessage({ command: "toolsStatus", html: toolHtml });
            webview.postMessage({ command: "log", text: `Discovered ${tools.length} tools.` });
          } else {
            webview.postMessage({
              command: "toolsStatus",
              html: `<span class="status-dot warn"></span>Server started but returned no tools.`,
            });
          }
        } catch (e) {
          webview.postMessage({
            command: "toolsStatus",
            html: `<span class="status-dot err"></span>Failed to list tools: ${(e as Error).message}`,
          });
        }
      } else {
        webview.postMessage({
          command: "configStatus",
          html: `<span class="status-dot err"></span>API Key is missing in settings`,
        });
        webview.postMessage({
          command: "toolsStatus",
          html: `Setup API Key to discover tools.`,
        });
      }

      // Check mcp.json config
      webview.postMessage({ command: "mcpConfigStatus", html: getMcpStatusHtml(readMcpJson()) });

      webview.postMessage({ command: "log", text: "Diagnostics complete." });
    }
  });
}

export function deactivate(): void {}
