#!/usr/bin/env node
/**
 * deploy.mjs — Deploy the Code Engine MCP server to Code Engine
 *              using MCP tools only (JSON-RPC over stdio).
 *
 * @author      Markus van Kempen <markus.van.kempen@gmail.com> | <mvankempen@ca.ibm.com>
 * @license     MIT
 * @repository  https://github.com/markusvankempen/code-engine-mcp-server
 *
 * Calls the following MCP tools in sequence:
 *   1. ce_list_projects          — verify project exists
 *   2. icr_list_namespaces       — verify ICR namespace
 *   3. ce_list_secrets           — check for existing pull secret
 *   4. ce_create_secret          — create pull secret if missing
 *   5. proc_build_push_deploy    — build → push → deploy → wait → URL
 *
 * Usage:
 *   node deploy.mjs
 *
 * Required env:
 *   IBMCLOUD_API_KEY   — IBM Cloud API key
 *
 * Optional env (override defaults):
 *   CE_PROJECT         — Code Engine project name or ID  (default: markus-app-v2-toronto)
 *   ICR_NAMESPACE      — ICR namespace                   (default: mvk-code-engine)
 *   ICR_HOST           — ICR hostname                    (default: us.icr.io)
 *   IMAGE_SECRET       — pull secret name in CE          (default: icr-pull-secret)
 *   APP_NAME           — CE application name             (default: ce-mcp-remote)
 *   IMAGE_TAG          — image tag                       (default: latest)
 *   CE_REGION          — Code Engine region              (default: us-south)
 *   CONTEXT_PATH       — path to Dockerfile directory    (default: examples/deploy-mcp-server-to-code-engine)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

// Read API key from VS Code extension settings if not set in env
function readVsCodeApiKey() {
  try {
    const home = process.env.HOME || '';
    const settingsPath = join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return settings['codeEngineMcp.apiKey'] || '';
  } catch {
    return '';
  }
}

const API_KEY = process.env.IBMCLOUD_API_KEY || readVsCodeApiKey();
const CE_PROJECT   = process.env.CE_PROJECT     || 'markus-app-v2-toronto';
const ICR_NS       = process.env.ICR_NAMESPACE  || 'mvk-code-engine';
const ICR_HOST     = process.env.ICR_HOST       || 'us.icr.io';
const IMAGE_SECRET = process.env.IMAGE_SECRET   || 'icr-pull-secret';
const APP_NAME     = process.env.APP_NAME       || 'ce-mcp-remote';
const IMAGE_TAG    = process.env.IMAGE_TAG      || 'latest';
const CE_REGION    = process.env.CE_REGION      || 'us-south';

// Context path relative to the repo root
const REPO_ROOT = join(__dirname, '..', '..');
const CONTEXT_PATH = process.env.CONTEXT_PATH
  || join(__dirname, '..', '..', 'examples', 'deploy-mcp-server-to-code-engine');

if (!API_KEY) {
  console.error('❌  IBMCLOUD_API_KEY not set and not found in VS Code extension settings.');
  process.exit(1);
}

// ── MCP JSON-RPC client ───────────────────────────────────────────────────────

const SERVER_BIN = join(REPO_ROOT, 'build', 'index.js');

let _msgId = 1;
const nextId = () => _msgId++;

async function callTool(toolName, args = {}, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_BIN], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, IBMCLOUD_API_KEY: API_KEY, IBMCLOUD_REGION: CE_REGION },
    });

    const initId = nextId();
    const callId = nextId();
    let stdout = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      // Try to parse each complete line
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === callId) {
            clearTimeout(timer);
            proc.kill('SIGTERM');
            if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else resolve(msg.result);
          }
        } catch { /* incomplete line */ }
      }
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on('error', (err) => { clearTimeout(timer); reject(err); });

    // Send initialize then the tool call
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: initId, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deploy.mjs', version: '1.0' } },
    }) + '\n');

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: callId, method: 'tools/call',
      params: { name: toolName, arguments: args },
    }) + '\n');
  });
}

function parseResult(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

function log(step, msg) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  STEP ${step}: ${msg}`);
  console.log('─'.repeat(60));
}

// ── Deployment pipeline ────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Code Engine MCP Server — Self-Deploy via MCP Tools    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  Project     : ${CE_PROJECT}`);
  console.log(`  ICR         : ${ICR_HOST}/${ICR_NS}/${APP_NAME}:${IMAGE_TAG}`);
  console.log(`  App name    : ${APP_NAME}`);
  console.log(`  Pull secret : ${IMAGE_SECRET}`);
  console.log(`  Context     : ${CONTEXT_PATH}`);
  console.log(`  API key     : ${API_KEY.slice(0, 8)}...`);

  // ── Step 1: Verify project ────────────────────────────────────────────────
  log(1, 'ce_list_projects — verify project exists');
  const projectsResult = parseResult(await callTool('ce_list_projects', {}));
  const projects = projectsResult?.projects || [];
  const project = projects.find(p =>
    p.name === CE_PROJECT || p.id === CE_PROJECT
  );
  if (!project) {
    const names = projects.map(p => `${p.name} (${p.region})`).join(', ');
    throw new Error(`Project "${CE_PROJECT}" not found. Available: ${names}`);
  }
  console.log(`  ✅ Found project: ${project.name} (id=${project.id}, region=${project.region})`);
  const PROJECT_ID = project.id;

  // ── Step 2: Verify ICR namespace ──────────────────────────────────────────
  log(2, 'icr_list_namespaces — verify namespace exists');
  const nsResult = parseResult(await callTool('icr_list_namespaces', { region: ICR_HOST }));
  const namespaces = Array.isArray(nsResult) ? nsResult : (nsResult?.namespaces || []);
  if (!namespaces.includes(ICR_NS)) {
    throw new Error(`ICR namespace "${ICR_NS}" not found. Available: ${namespaces.join(', ')}`);
  }
  console.log(`  ✅ ICR namespace confirmed: ${ICR_NS}`);

  // ── Step 3: Check for pull secret ─────────────────────────────────────────
  log(3, `ce_list_secrets — check for "${IMAGE_SECRET}" in project`);
  const secretsResult = parseResult(await callTool('ce_list_secrets', { project_id: PROJECT_ID }));
  const secrets = secretsResult?.secrets || [];
  const secretExists = secrets.some(s => s.name === IMAGE_SECRET);
  console.log(`  ${secretExists ? '✅ Pull secret exists' : '⚠️  Pull secret not found — will create it'}: ${IMAGE_SECRET}`);

  // ── Step 4: Create pull secret if missing ─────────────────────────────────
  if (!secretExists) {
    log(4, `ce_create_secret — create registry pull secret "${IMAGE_SECRET}"`);
    const secretResult = parseResult(await callTool('ce_create_secret', {
      project_id: PROJECT_ID,
      name: IMAGE_SECRET,
      format: 'registry',
      data: {
        username: 'iamapikey',
        password: API_KEY,
        server: ICR_HOST,
        email: 'unused@example.com',
      },
    }));
    console.log(`  ✅ Created pull secret: ${secretResult?.name || IMAGE_SECRET}`);
  } else {
    console.log(`\n  STEP 4: Skipped — pull secret already exists`);
  }

  // ── Step 5: Build → push → deploy (proc_build_push_deploy) ───────────────
  log(5, 'proc_build_push_deploy — build image, push to ICR, deploy to Code Engine');
  console.log('\n  This step runs the full pipeline:');
  console.log('    → detect container runtime');
  console.log('    → build for linux/amd64');
  console.log('    → login to ICR');
  console.log('    → push image');
  console.log('    → refresh ICR pull secret');
  console.log('    → create/update CE application');
  console.log('    → wait for ready');
  console.log('\n  ⏳ This takes 3–8 minutes. Please wait...\n');

  // A timestamp env var ensures Code Engine sees a config change on every deploy,
  // which forces it to create a new revision and pull the freshly-pushed image.
  // Without this, CE skips a new revision when the image tag (e.g. :latest) is unchanged.
  const deployTime = new Date().toISOString();

  const deployResult = parseResult(await callTool('proc_build_push_deploy', {
    context_path: CONTEXT_PATH,
    project_id_or_name: PROJECT_ID,
    app_name: APP_NAME,
    image_secret: IMAGE_SECRET,
    icr_namespace: ICR_NS,
    image_tag: IMAGE_TAG,
    icr_host: ICR_HOST,
    port: 8080,
    scale_min_instances: 1,
    scale_max_instances: 5,
    scale_cpu_limit: '0.5',
    scale_memory_limit: '1G',
    env_vars: {
      IBMCLOUD_API_KEY: API_KEY,
      IBMCLOUD_REGION: CE_REGION,
      BRIDGE_DEPLOY_TIME: deployTime,
    },
    timeout_seconds: 300,
  }, 600_000));

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    DEPLOYMENT COMPLETE                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const endpoint = deployResult?.endpoint || deployResult?.url || '(see Code Engine console)';
  const image = deployResult?.image || `${ICR_HOST}/${ICR_NS}/${APP_NAME}:${IMAGE_TAG}`;
  const status = deployResult?.status || 'ready';

  console.log(`  Status   : ${status}`);
  console.log(`  Image    : ${image}`);
  console.log(`  Endpoint : ${endpoint}`);
  console.log(`  SSE URL  : ${endpoint}/sse`);
  console.log(`  Health   : ${endpoint}/health`);

  console.log('\n  Add to .vscode/mcp.json:');
  console.log(JSON.stringify({
    servers: {
      'code-engine-remote': {
        type: 'sse',
        url: `${endpoint}/sse`,
      },
    },
  }, null, 2).split('\n').map(l => '  ' + l).join('\n'));

  if (deployResult?.build_output) {
    console.log('\n  Build output (last 20 lines):');
    const lines = String(deployResult.build_output).split('\n').slice(-20);
    lines.forEach(l => console.log('  ' + l));
  }
}

main().catch(err => {
  console.error('\n❌ Deployment failed:', err.message);
  process.exit(1);
});
