# Connect to the IBM Code Engine MCP Server

The server sits between callers and IBM Cloud.

| | On this machine | Shared HTTP server |
|---|---|---|
| **Transport** | stdio, started by the IDE | `POST /mcp` (Streamable HTTP) or `/sse` |
| **IBM Cloud key** | `IBMCLOUD_API_KEY` on that process | Stored once on the server (`server_settings` action `secrets`, or the admin page). Callers never receive it. |
| **Who may call tools** | The IDE process. No separate login. | A user (`Authorization: Basic` username and password) or an MCP API key this server issued (`Authorization: Bearer cemcp_...`) |
| **Best for** | One person, one laptop | Several programs, CI, or another IDE talking to one server |

Get an IBM Cloud API key at [cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys). On a shared server, create users with `server_users` and MCP API keys with `server_api_keys`. Those credentials are not IBM Cloud keys. Scope `read`, `write`, or `admin` on the user or key limits the tools. The server still calls Code Engine with its own IBM Cloud key.

The VS Code extension can use either one. In the sidebar (**Setup & Diagnostics → Server connection**) pick **This computer** or **Remote server**. For a remote server enter the URL (`https://your-server.example/mcp`) and, if the server asks for one, a user password (`user:password`) or an MCP API key (`cemcp_...`). **Test connection** shows the server's version, tool count, and whether it is older than the newest release on npm. **Configure MCP** then writes a `code-engine-remote` entry (not the IBM Cloud key) into each IDE's config and leaves the local `code-engine` entry alone. The credential is stored in VS Code SecretStorage, and the extension refuses to send it over plain `http://` to another machine.

**Any host works.** The server is a plain HTTP app (`MCP_MODE=http`, listens on `PORT`), so you can run it on IBM Code Engine, Render, Fly.io, Railway, a VM, or a container on your own network. Give the extension the public `https://` address of that host with the path `/mcp`. Nothing in the extension is tied to one provider. If **Test connection** says HTTP 404, the app is stopped or deleted or the path is wrong; HTTP 502/503 means the host is up but the server behind it is not.

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
      "type": "http",
      "serverUrl": "https://your-server.example/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CODE_ENGINE_MCP_API_KEY}"
      }
    }
  }
}
```

For the local process, set the IBM Cloud key in your shell before launching the IDE:

```bash
export IBMCLOUD_API_KEY="your-ibm-cloud-api-key"
```

For a shared server, set the MCP API key that server issued (or send Basic auth). Do not put the IBM Cloud key in the client:

```bash
export CODE_ENGINE_MCP_API_KEY="cemcp_..."
```

> **Note:** `IBMCLOUD_REGION` is the default region of the server process. A shared server uses the region saved with its IBM Cloud key. Callers do not choose that key.
>
> The VS Code extension **Configure MCP** writes the local entry to `~/.gemini/config/mcp_config.json` and, in the open workspace, `.agents/mcp_config.json`. In remote mode it writes the `code-engine-remote` entry shown above instead.

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
      "type": "http",
      "url": "https://your-server.example/mcp",
      "headers": {
        "Authorization": "Bearer cemcp_..."
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
      "url": "https://your-server.example/mcp",
      "headers": {
        "Authorization": "Basic BASE64_USER_PASSWORD"
      }
    }
  }
}
```

---

## Notes

- The local server requires Node.js 18+ and internet access to IBM Cloud APIs.
- A shared server stores the IBM Cloud key. Each program sends its own user password or an MCP API key issued by that server. `Basic` is `base64(username:password)` from `server_users`. `Bearer` is the secret from `server_api_keys` action `issue`.
- Both paths expose the same Code Engine tools. The caller's scope decides which of those tools run.
