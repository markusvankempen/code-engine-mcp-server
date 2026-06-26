#!/usr/bin/env node
/**
 * bridge.mjs — Minimal HTTP/SSE bridge for any stdio MCP server
 *
 * Implements the MCP SSE transport without supergateway or any external dependencies.
 * Reference: https://spec.modelcontextprotocol.io/specification/basic/transports/#http-with-sse
 *
 * Protocol:
 *   GET  /sse                        — open SSE stream; server replies with an "endpoint" event
 *   POST /message?sessionId=<id>     — send a JSON-RPC message to the MCP server
 *   GET  /health                     — liveness probe (returns 200 "ok")
 *
 * One MCP server process is spawned per SSE connection and terminated when
 * the connection closes. The IBM Cloud API key must be provided by the client
 * via headers (Authorization: Bearer <key> or X-IBMCloud-API-Key: <key>)
 * or query parameter (apiKey=<key>).
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORT = parseInt(process.env.PORT ?? '8080', 10);

// Path to the MCP server binary (globally installed by Dockerfile).
// Override via MCP_BIN env var if needed.
const MCP_BIN = process.env.MCP_BIN ?? 'code-engine-mcp-server';
console.log(`[bridge] Using MCP_BIN: ${MCP_BIN}`);

// ── MCP server metadata (populated at startup by probing the server) ──────────
const mcpMeta = { name: 'code-engine-mcp-server', version: 'unknown', author: 'Markus van Kempen', tools: [], toolCount: 0 };

// Try to read version + author from the globally-installed package.json
for (const p of [
  './package.json',
  './node_modules/code-engine-mcp-server/package.json',
  '/usr/local/lib/node_modules/code-engine-mcp-server/package.json',
  '/usr/lib/node_modules/code-engine-mcp-server/package.json',
]) {
  try {
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    if (pkg.version) mcpMeta.version = pkg.version;
    if (pkg.author)  mcpMeta.author  = typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? mcpMeta.author);
    break;
  } catch { /* not found at this path */ }
}

/**
 * Probe the MCP server once at startup to capture serverInfo and tool count.
 * Runs asynchronously so the bridge starts immediately while probing in background.
 */
function probeMcpServer() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    const mcpArgs = MCP_BIN.split(' ');
    const mcpCmd = mcpArgs.shift();
    const apiKey = process.env.IBMCLOUD_API_KEY;
    
    if (!apiKey) {
      console.log('[probe] Skipping startup probe: No server-side IBMCLOUD_API_KEY found (Stateless Mode).');
      return finish();
    }

    const proc = spawn(mcpCmd, mcpArgs, { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', finish);
    proc.on('exit', finish);

    const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bridge-probe', version: '1' } } });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    // Give the server up to 10 s to respond, then parse what we have
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* already exited */ }
      for (const line of out.split('\n')) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result?.serverInfo) {
            if (msg.result.serverInfo.version) mcpMeta.version = msg.result.serverInfo.version;
            if (msg.result.serverInfo.name)    mcpMeta.name    = msg.result.serverInfo.name;
          }
          if (msg.id === 2 && Array.isArray(msg.result?.tools)) {
            mcpMeta.tools = msg.result.tools;
            mcpMeta.toolCount = msg.result.tools.length;
          }
        } catch { /* unparseable line */ }
      }
      console.log(`[probe] MCP server probed: ${mcpMeta.name} v${mcpMeta.version}, ${mcpMeta.toolCount} tools`);
      finish();
    }, 10_000);
    timer.unref();
  });
}

probeMcpServer().catch((err) => console.error('[probe] failed:', err.message));

/** @type {Map<string, { res: import('node:http').ServerResponse, proc: import('node:child_process').ChildProcess }>} */
const sessions = new Map();

// ── Tool usage counters (in-memory, resets on restart) ────────────────────────
/** @type {Map<string, { calls: number, lastUsed: Date }>} */
const toolStats = new Map();

function recordToolCall(toolName) {
  const entry = toolStats.get(toolName);
  if (entry) {
    entry.calls += 1;
    entry.lastUsed = new Date();
  } else {
    toolStats.set(toolName, { calls: 1, lastUsed: new Date() });
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS).end();
    return;
  }

  // ── Health probe (Code Engine liveness / readiness check) ───────────────────
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS }).end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // ── Tool usage statistics ─────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/stats') {
    const sorted = [...toolStats.entries()].sort((a, b) => b[1].calls - a[1].calls);
    const total = sorted.reduce((s, [, v]) => s + v.calls, 0);
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS }).end(
      JSON.stringify({
        totalCalls: total,
        tools: Object.fromEntries(sorted.map(([name, d]) => [name, { calls: d.calls, lastUsed: d.lastUsed.toISOString() }])),
        generatedAt: new Date().toISOString(),
      }, null, 2)
    );
    return;
  }

  // ── Discovery Handler (for mcp-remote fallback) ──────────────────────────
  if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration')) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const scheme = req.headers['x-forwarded-proto'] || 'http';
    const origin = `${scheme}://${host}`;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer: origin,
      authorization_endpoint: `${origin}/sse`,
      token_endpoint: `${origin}/sse`, // dummy
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"]
    }));
    return;
  }

  // ── SSE Handler (GET or POST /sse) ──────────────────────────────────────────
  if (url.pathname === '/sse') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST', ...CORS_HEADERS }).end('Method Not Allowed');
      return;
    }

    const sessionId = randomUUID();

    // Extract API key from headers or query param
    const apiKey = req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
                   req.headers['x-ibmcloud-api-key'] ||
                   url.searchParams.get('apiKey');

    if (!apiKey) {
      console.log(`[${sessionId}] SSE connection rejected: Missing API Key`);
      res.writeHead(401, { 'Content-Type': 'text/plain', ...CORS_HEADERS })
         .end('Unauthorized: Missing IBM Cloud API Key. Provide via Authorization header.');
      return;
    }

    // MCP SSE spec: first event must be "endpoint" with the absolute POST URL.
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const scheme = req.headers['x-forwarded-proto'] || 'https';
    const messageUrl = `${scheme}://${host}/message?sessionId=${sessionId}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...CORS_HEADERS
    });
    res.write(`event: endpoint\ndata: ${messageUrl}\n\n`);
    if (res.flush) res.flush(); // ensure data is sent immediately

    // ── Heartbeat (Keep-alive for Code Engine Activator) ──────────────────────
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keep-alive\n\n');
        if (res.flush) res.flush();
      }
    }, 15000);

    // Spawn one MCP server process per client session.
    // The provided API key is injected into the environment.
    const mcpArgs = MCP_BIN.split(' ');
    const mcpCmd = mcpArgs.shift();
    const proc = spawn(mcpCmd, mcpArgs, {
      env: { ...process.env, IBMCLOUD_API_KEY: apiKey },
      stdio: ['pipe', 'pipe', 'inherit'], // stdin/stdout piped; stderr goes to container logs
    });

    sessions.set(sessionId, { res, proc });
    console.log(`[${sessionId}] Session opened (pid=${proc.pid})`);

    // MCP server stdout → SSE data events (newline-delimited JSON-RPC)
    let partial = '';
    proc.stdout.on('data', (chunk) => {
      partial += chunk.toString('utf8');
      const lines = partial.split('\n');
      partial = lines.pop(); // keep any incomplete trailing line for the next chunk
      for (const line of lines) {
        if (line.trim().length > 0) {
          res.write(`data: ${line}\n\n`);
        }
      }
    });

    proc.on('error', (err) => {
      console.error(`[${sessionId}] MCP process error:`, err.message);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[${sessionId}] MCP process exited (code=${code}, signal=${signal})`);
      sessions.delete(sessionId);
      clearInterval(heartbeatInterval);
      try { res.end(); } catch { /* already closed */ }
    });

    // Clean up when the client disconnects
    req.on('close', () => {
      console.log(`[${sessionId}] Client disconnected`);
      sessions.delete(sessionId);
      clearInterval(heartbeatInterval);
      proc.kill('SIGTERM');
    });

    return;
  }

  // ── POST /message — client → MCP server ────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/message') {
    const sessionId = url.searchParams.get('sessionId');
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS })
        .end('Session not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      try {
        // Validate JSON before forwarding to prevent malformed input reaching the server
        const msg = JSON.parse(body);
        if (msg.method === 'tools/call' && msg.params?.name) {
          recordToolCall(msg.params.name);
        }
        session.proc.stdin.write(body + '\n');
        res.writeHead(202, CORS_HEADERS).end();
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain', ...CORS_HEADERS })
          .end('Invalid JSON');
      }
    });

    return;
  }

  // ── GET / — diagnostic page ──────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const scheme = req.headers['x-forwarded-proto'] || 'http';
    const base = `${scheme}://${host}`;
    const activeSessions = sessions.size;
    const uptime = Math.floor(process.uptime());
    const uptimeStr = uptime < 60 ? `${uptime}s`
      : uptime < 3600 ? `${Math.floor(uptime/60)}m ${uptime%60}s`
      : `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`;
    const sortedStats = [...toolStats.entries()].sort((a, b) => b[1].calls - a[1].calls);
    const totalCalls = sortedStats.reduce((s, [, v]) => s + v.calls, 0);
    const maxCalls = sortedStats[0]?.[1].calls ?? 1;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }).end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Code Engine MCP Server</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;padding:2rem}
    h1{font-size:1.6rem;font-weight:700;margin-bottom:.25rem}
    .subtitle{color:#94a3b8;margin-bottom:2rem;font-size:.95rem}
    .badge{display:inline-block;padding:.2rem .6rem;border-radius:9999px;font-size:.75rem;font-weight:600;margin-left:.5rem;vertical-align:middle}
    .badge-green{background:#166534;color:#86efac}
    .card{background:#1e2130;border:1px solid #2d3748;border-radius:.75rem;padding:1.25rem 1.5rem;margin-bottom:1.25rem}
    .card h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:1rem}
    table{width:100%;border-collapse:collapse}
    td{padding:.45rem .5rem;vertical-align:top}
    td:first-child{color:#94a3b8;white-space:nowrap;width:11rem;font-size:.9rem}
    td:last-child{font-family:'SF Mono',Menlo,monospace;font-size:.875rem;word-break:break-all}
    a{color:#60a5fa;text-decoration:none}
    a:hover{text-decoration:underline}
    .endpoint{display:flex;align-items:center;gap:.5rem;margin:.35rem 0}
    .method{font-size:.72rem;font-weight:700;padding:.15rem .45rem;border-radius:.3rem;flex-shrink:0}
    .get{background:#1e3a5f;color:#60a5fa}
    .post{background:#3b2a1a;color:#fb923c}
    .url{font-family:'SF Mono',Menlo,monospace;font-size:.85rem;color:#e2e8f0}
    .desc{font-size:.8rem;color:#64748b;margin-left:.25rem}
    pre{background:#0f1117;border:1px solid #2d3748;border-radius:.5rem;padding:1rem;overflow-x:auto;font-size:.82rem;line-height:1.6}
    .stat{display:inline-flex;flex-direction:column;align-items:center;padding:.75rem 1.5rem;background:#0f1117;border-radius:.5rem;border:1px solid #2d3748;margin-right:.75rem}
    .stat-val{font-size:1.5rem;font-weight:700;color:#60a5fa}
    .stat-label{font-size:.75rem;color:#64748b;margin-top:.2rem}
    .stats-row{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.5rem}
  </style>
</head>
<body>
  <h1>Code Engine MCP Server <span class="badge badge-green">● running</span></h1>
  <p class="subtitle">IBM Cloud Code Engine · MCP SSE Bridge · <a href="https://markusvankempen.github.io/" target="_blank">Markus van Kempen</a></p>

    <div class="card" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3);">
      <h2 style="color: #f87171;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        Stateless Security Model
      </h2>
      <p style="font-size: 0.95rem; color: #fca5a5; margin: 0;">
        This server is operating in <strong>Stateless Proxy Mode</strong>. No IBM Cloud credentials are stored on this server.
        To use this MCP server, you <strong>must</strong> provide your <code>IBMCLOUD_API_KEY</code> in each connection request.
      </p>
    </div>

  <div class="card">
    <h2>Runtime</h2>
    <div class="stats-row">
      <div class="stat"><span class="stat-val">${activeSessions}</span><span class="stat-label">active sessions</span></div>
      <div class="stat"><span class="stat-val">${mcpMeta.toolCount}</span><span class="stat-label">MCP tools</span></div>
      <div class="stat"><span class="stat-val">${uptimeStr}</span><span class="stat-label">uptime</span></div>
      <div class="stat"><span class="stat-val">${process.version}</span><span class="stat-label">node</span></div>
    </div>
  </div>

  <div class="card">
    <h2>Tool Usage <span style="font-size:.8rem;color:#64748b;font-weight:400;text-transform:none">(since last restart &middot; ${totalCalls} call${totalCalls !== 1 ? 's' : ''})</span></h2>
    ${sortedStats.length === 0
      ? '<p style="color:#64748b;font-size:.875rem">No tool calls recorded yet. Stats are in-memory and reset on server restart.</p>'
      : `<div style="display:flex;flex-direction:column;gap:.6rem">
          ${sortedStats.map(([name, data]) => {
            const pct = Math.round((data.calls / maxCalls) * 100);
            return `<div style="display:grid;grid-template-columns:16rem 3rem 1fr;align-items:center;gap:.75rem">
              <div style="font-family:'SF Mono',Menlo,monospace;font-size:.8rem;color:#60a5fa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${name}">${name}</div>
              <div style="font-size:.8rem;color:#e2e8f0;text-align:right;font-weight:600">${data.calls}</div>
              <div style="background:#0f1117;border-radius:9999px;height:.5rem;overflow:hidden;border:1px solid #2d3748">
                <div style="background:linear-gradient(90deg,#3b82f6,#7c3aed);height:100%;width:${pct}%;border-radius:9999px"></div>
              </div>
            </div>`;
          }).join('')}
        </div>`
    }
  </div>

  <div class="card">
    <h2>Available Tools</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem">
      ${mcpMeta.tools.map(t => `
        <div style="background:#0f1117;border:1px solid #2d3748;border-radius:.5rem;padding:.75rem">
          <div style="font-family:'SF Mono',Menlo,monospace;color:#60a5fa;font-weight:700;font-size:.8rem;margin-bottom:.25rem">${t.name}</div>
          <div style="font-size:.75rem;color:#94a3b8;line-height:1.4">${t.description || 'No description provided'}</div>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="card">
    <h2>Server info</h2>
    <table>
      <tr><td>Host</td><td>${host}</td></tr>
      <tr><td>MCP server</td><td>${mcpMeta.name} v${mcpMeta.version}</td></tr>
      <tr><td>Developer</td><td>Markus van Kempen <br> <span style="font-size:0.8rem; color:#94a3b8">markus.van.kempen@gmail.com | mvankempen@ca.ibm.com</span></td></tr>
      <tr><td>Tools</td><td>${mcpMeta.toolCount} tools discovered</td></tr>
      <tr><td>MCP binary</td><td>${MCP_BIN}</td></tr>
      <tr><td>Port</td><td>${PORT}</td></tr>
      <tr><td>Region</td><td>${process.env.CE_REGION || 'n/a'}</td></tr>
      <tr><td>Project</td><td>${process.env.CE_PROJECT_ID || 'n/a'}</td></tr>
      <tr><td>App name</td><td>${process.env.CE_APP || 'n/a'}</td></tr>
      <tr><td>Deployed at</td><td>${process.env.BRIDGE_DEPLOY_TIME || 'n/a'}</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>Endpoints</h2>
    <div class="endpoint"><span class="method get">GET</span><span class="method post" style="margin-left:2px">POST</span><span class="url"><a href="${base}/sse">${base}/sse</a></span><span class="desc">— open SSE stream (Streamable HTTP supported)</span></div>
    <div class="endpoint"><span class="method post">POST</span><span class="url">${base}/message?sessionId=&lt;id&gt;</span><span class="desc">— send JSON-RPC to session</span></div>
    <div class="endpoint"><span class="method get">GET</span><span class="url"><a href="${base}/health">${base}/health</a></span><span class="desc">— liveness probe</span></div>
    <div class="endpoint"><span class="method get">GET</span><span class="url"><a href="${base}/stats">${base}/stats</a></span><span class="desc">— tool usage statistics (JSON)</span></div>
    <div class="endpoint"><span class="method get">GET</span><span class="url">${base}/</span><span class="desc">— this page</span></div>
  </div>

  <div class="card">
    <h2>Connect from VS Code</h2>
    <pre>{
  "servers": {
    "code-engine-remote": {
      "type": "sse",
      "url": "${base}/sse",
      "headers": {
        "Authorization": "Bearer YOUR_IBMCLOUD_API_KEY"
      }
    }
  }
}</pre>
  </div>

  <div class="card">
    <h2>Connect from Claude Desktop / Cursor (via npx mcp-remote)</h2>
    <pre>{
  "mcpServers": {
    "code-engine-remote": {
      "command": "npx",
      "args": ["mcp-remote", "${base}/sse"],
      "env": {
        "IBMCLOUD_API_KEY": "YOUR_IBMCLOUD_API_KEY"
      }
    }
  }
}</pre>
  </div>
</body>
</html>`);
    return;
  }

  // ── 404 Handler ────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS })
     .end(JSON.stringify({ error: 'Not found', message: 'The requested path does not exist.' }));

}).listen(PORT, '0.0.0.0', () => {
  console.log(`MCP SSE bridge ready on port ${PORT}`);
  console.log(`  GET  /sse                     — open SSE stream`);
  console.log(`  POST /message?sessionId=<id>  — send JSON-RPC`);
  console.log(`  GET  /health                  — liveness probe`);
  console.log(`  MCP server binary: ${MCP_BIN}`);
});
