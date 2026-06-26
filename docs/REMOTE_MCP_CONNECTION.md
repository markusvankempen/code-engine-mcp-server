# Connect to the IBM Code Engine MCP Servers

Two MCP server options are available:

| | `code-engine` (local) | `code-engine-remote` (remote) |
|---|---|---|
| **Transport** | stdio | SSE |
| **Runs** | On your machine via `npx` | On IBM Cloud Code Engine (ca-tor) |
| **Auth** | `IBMCLOUD_API_KEY` env var | `Authorization` request header |
| **Best for** | Development / local use | Shared teams, CI, remote IDEs |

Get an IBM Cloud API key at [cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys).

---

## Antigravity IDE — `mcp_config.json`

Antigravity uses `"mcpServers"` as the top-level key and supports `${env:VAR}` syntax to read values from your shell environment, so your API key never has to be hardcoded in the file.

```json
{
  "mcpServers": {
    "code-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": {
        "IBMCLOUD_API_KEY": "${env:IBMCLOUD_API_KEY}",
        "IBMCLOUD_REGION": "us-south"
      }
    },
    "code-engine-remote": {
      "type": "sse",
      "serverUrl": "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse",
      "headers": {
        "Authorization": "${env:IBMCLOUD_API_KEY}"
      }
    }
  }
}
```

Set your API key in your shell before launching the IDE:

```bash
export IBMCLOUD_API_KEY="your-api-key-here"
```

Or add it to your `~/.zshrc` / `~/.bashrc` so it is always available.

> **Note:** `IBMCLOUD_REGION` controls which region the **local** server targets by default (e.g. `us-south`, `ca-tor`, `eu-de`). The remote server always runs in `ca-tor` but can manage resources in any region.

---

## VS Code (`mcp.json`)

VS Code uses `"servers"` (not `"mcpServers"`) as the top-level key. Open it via the **MCP: Open User MCP Config** command (`Ctrl/Cmd+Shift+P`).

```json
{
  "servers": {
    "code-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": {
        "IBMCLOUD_API_KEY": "YOUR_IBMCLOUD_API_KEY",
        "IBMCLOUD_REGION": "us-south"
      }
    },
    "code-engine-remote": {
      "type": "sse",
      "url": "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse",
      "headers": {
        "Authorization": "YOUR_IBMCLOUD_API_KEY"
      }
    }
  }
}
```

---

## Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "code-engine": {
      "command": "npx",
      "args": ["-y", "code-engine-mcp-server@latest"],
      "env": {
        "IBMCLOUD_API_KEY": "YOUR_IBMCLOUD_API_KEY",
        "IBMCLOUD_REGION": "us-south"
      }
    },
    "code-engine-remote": {
      "transport": {
        "type": "sse",
        "url": "https://ce-mcp-remote.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud/sse",
        "headers": {
          "Authorization": "YOUR_IBMCLOUD_API_KEY"
        }
      }
    }
  }
}
```

---

## Notes

- The **local** server (`code-engine`) requires Node.js 18+ and internet access to IBM Cloud APIs.
- The **remote** server (`code-engine-remote`) is stateless — the API key is passed per-connection via the `Authorization` header; no server-side env var is stored.
- The remote server scales to zero when idle — the first request may take a few seconds to wake up.
- Both servers expose the same IBM Code Engine MCP tools: deploy apps, manage builds, list projects, ICR operations, and more.
