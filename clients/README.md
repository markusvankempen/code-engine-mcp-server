# Clients

Pages that show how to connect a client to [code-engine-mcp-server](https://github.com/markusvankempen/code-engine-mcp-server).

| Page | What it shows |
|---|---|
| [index.html](index.html) | The set, and how to open it |
| [cursor.html](cursor.html) | Cursor `mcp.json`, local npx and a hosted URL |
| [vscode.html](vscode.html) | VS Code `mcp.json` |
| [claude.html](claude.html) | Claude Desktop, including `mcp-remote` |
| [windsurf.html](windsurf.html) | Windsurf `mcp_config.json` (`serverUrl`) |
| [cli.html](cli.html) | The `mcp>` CLI (run from a source checkout): `npm start` and `./run-client.sh` |
| [browser.html](browser.html) | Pick any published tool and action, then call it |
| [settings.html](settings.html) | Read `get_settings` and change region and activity logging |

The HTTP server serves this folder at `/clients/`. With the server running, open `http://127.0.0.1:8787/clients/`.

```bash
MCP_MODE=http PORT=8787 IBMCLOUD_API_KEY=your-key npx -y code-engine-mcp-server
```

To open the folder on its own:

```bash
cd clients
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/. Point the browser page at `http://127.0.0.1:8787/mcp`.
