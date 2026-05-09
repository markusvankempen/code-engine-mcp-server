#!/usr/bin/env tsx
/**
 * test-all-tools.ts — Smoke-test all 43 Code Engine MCP tools
 * Author: Markus van Kempen | markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
 * https://markusvankempen.github.io/ — No bug too small, no syntax too weird.
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });
dotenv.config({ path: join(__dirname, '../../../.env') });

const apiKey = process.env.IBMCLOUD_API_KEY;
if (!apiKey) { console.error('ERROR: IBMCLOUD_API_KEY not set'); process.exit(1); }

const serverPath = join(__dirname, '..', 'build', 'index.js');

// ─── MCP call helper ─────────────────────────────────────────────────────────
function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve) => {
    const proc = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, IBMCLOUD_API_KEY: apiKey! },
    });

    const request = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name, arguments: args },
    });

    let resolved = false;
    let stdout = '';
    let stderr = '';

    const tryResolve = () => {
      for (const line of stdout.split('\n')) {
        try {
          const p = JSON.parse(line.trim());
          if (p.result || p.error) {
            if (!resolved) { resolved = true; proc.kill('SIGTERM'); resolve(p); }
            return;
          }
        } catch {}
      }
    };

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); tryResolve(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', () => {
      if (!resolved) {
        tryResolve();
        if (!resolved) {
          const errLine = stderr.split('\n').find(l => l.includes('Error') || l.includes('error')) || 'no response';
          resolve({ error: { message: errLine.trim() } });
        }
      }
    });

    // Keep stdin open — closing it triggers EOF which shuts down the MCP transport
    proc.stdin.write(request + '\n');

    setTimeout(() => {
      if (!resolved) { resolved = true; proc.kill('SIGTERM'); resolve({ error: { message: 'timeout (30s)' } }); }
    }, 30000);
  });
}

// ─── Tracking ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, skip = 0;

function ok(label: string, tool: string, r: any) {
  if (r?.result) {
    console.log(`  ✅  PASS  [${label}] ${tool}`);
    pass++;
  } else {
    const msg = r?.error?.message ?? 'unknown';
    console.log(`  ❌  FAIL  [${label}] ${tool} — ${msg}`);
    fail++;
  }
}

function sk(label: string, tool: string, reason: string) {
  console.log(`  ⚠️   SKIP  [${label}] ${tool} — ${reason}`);
  skip++;
}

function extractFirst(resp: any, listKey: string): string {
  try {
    const text: string = resp?.result?.content?.[0]?.text ?? '';
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data[listKey] ?? []);
    if (list.length > 0) return list[0].name ?? list[0].id ?? '';
  } catch {}
  return '';
}

function extractId(resp: any): string {
  try {
    const text: string = resp?.result?.content?.[0]?.text ?? '';
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data.projects ?? data.items ?? []);
    if (list.length > 0) return list[0].id ?? list[0].guid ?? '';
  } catch {}
  // regex fallback for UUID
  const m = JSON.stringify(resp).match(/"id":"([0-9a-f-]{36})"/);
  return m ? m[1] : '';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  IBM Code Engine MCP Server — Tool Smoke Tests (43 tools)');
  console.log(`  Server: ${serverPath}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 🐳 Container Tools (8) ──────────────────────────────────────────────
  console.log('── 🐳  Container Tools ──────────────────────────────────────');
  ok('container', 'detect_container_runtime', await callTool('detect_container_runtime'));
  ok('container', 'list_local_images',        await callTool('list_local_images',     { runtime: 'auto' }));
  ok('container', 'list_local_containers',    await callTool('list_local_containers', { runtime: 'auto', all: true }));
  sk('container', 'build_container_image',    'requires Dockerfile (run manually)');
  sk('container', 'push_container_image',     'requires registry auth (run manually)');
  sk('container', 'test_container_locally',   'depends on build (run manually)');
  sk('container', 'get_container_logs',       'requires running container (run manually)');
  sk('container', 'stop_local_container',     'requires running container (run manually)');
  console.log();

  // ── ☁️ CE Projects (4) ──────────────────────────────────────────────────
  console.log('── ☁️   Code Engine: Projects ──────────────────────────────');
  const projectsResp = await callTool('ce_list_projects');
  ok('ce-projects', 'ce_list_projects', projectsResp);

  const projectId = extractId(projectsResp);

  if (projectId) {
    console.log(`   Using project_id: ${projectId}`);
    ok('ce-projects', 'ce_get_project', await callTool('ce_get_project', { project_id: projectId }));
  } else {
    sk('ce-projects', 'ce_get_project', 'no project found');
  }
  sk('ce-projects', 'ce_create_project', 'would create a real project (run manually)');
  sk('ce-projects', 'ce_delete_project',  'destructive (run manually)');
  console.log();

  if (!projectId) {
    console.log('   ⚠️  No project_id — skipping all project-scoped tests');
    skip += 18;
    return summary();
  }

  // ── 🚀 CE Applications (7) ──────────────────────────────────────────────
  console.log('── 🚀  Code Engine: Applications ──────────────────────────');
  const appsResp = await callTool('ce_list_applications', { project_id: projectId });
  ok('ce-apps', 'ce_list_applications', appsResp);

  const appName = extractFirst(appsResp, 'applications');
  if (appName) {
    ok('ce-apps', 'ce_get_application', await callTool('ce_get_application', { project_id: projectId, app_name: appName }));
    ok('ce-apps', 'ce_list_app_instances', await callTool('ce_list_app_instances', { project_id: projectId, app_name: appName }));
  } else {
    sk('ce-apps', 'ce_get_application', 'no apps in project');
    sk('ce-apps', 'ce_list_app_instances', 'no apps in project');
  }
  sk('ce-apps', 'ce_get_app_logs', 'requires a running instance name (run manually)');
  sk('ce-apps', 'ce_create_application', 'would deploy a real app (run manually)');
  sk('ce-apps', 'ce_update_application', 'depends on ce_create_application');
  sk('ce-apps', 'ce_delete_application', 'destructive (run manually)');
  console.log();

  // ── 🏗️ CE Builds (7) ────────────────────────────────────────────────────
  console.log('── 🏗️   Code Engine: Builds ────────────────────────────────');
  const buildsResp = await callTool('ce_list_builds', { project_id: projectId });
  ok('ce-builds', 'ce_list_builds', buildsResp);
  const brResp = await callTool('ce_list_build_runs', { project_id: projectId });
  ok('ce-builds', 'ce_list_build_runs', brResp);

  const buildName = extractFirst(buildsResp, 'builds');
  if (buildName) {
    ok('ce-builds', 'ce_get_build', await callTool('ce_get_build', { project_id: projectId, build_name: buildName }));
  } else {
    sk('ce-builds', 'ce_get_build', 'no builds found');
  }
  const buildRunName = extractFirst(brResp, 'build_runs');
  if (buildRunName) {
    ok('ce-builds', 'ce_get_build_run', await callTool('ce_get_build_run', { project_id: projectId, build_run_name: buildRunName }));
  } else {
    sk('ce-builds', 'ce_get_build_run', 'no build runs found');
  }
  sk('ce-builds', 'ce_create_build',     'would create a real build config (run manually)');
  sk('ce-builds', 'ce_create_build_run', 'depends on ce_create_build');
  sk('ce-builds', 'ce_delete_build',     'destructive (run manually)');
  sk('ce-builds', 'ce_delete_build_run', 'destructive (run manually)');
  console.log();

  // ── ⚙️ CE Jobs (8) ──────────────────────────────────────────────
  console.log('── ⚙️   Code Engine: Jobs ───────────────────────────────────────');
  const jobsResp = await callTool('ce_list_jobs', { project_id: projectId });
  ok('ce-jobs', 'ce_list_jobs', jobsResp);
  const jobRunsResp = await callTool('ce_list_job_runs', { project_id: projectId });
  ok('ce-jobs', 'ce_list_job_runs', jobRunsResp);

  const jobName = extractFirst(jobsResp, 'jobs');
  if (jobName) {
    ok('ce-jobs', 'ce_get_job', await callTool('ce_get_job', { project_id: projectId, job_name: jobName }));
  } else {
    sk('ce-jobs', 'ce_get_job', 'no jobs found');
  }
  const jobRunName = extractFirst(jobRunsResp, 'job_runs');
  if (jobRunName) {
    ok('ce-jobs', 'ce_get_job_run', await callTool('ce_get_job_run', { project_id: projectId, job_run_name: jobRunName }));
  } else {
    sk('ce-jobs', 'ce_get_job_run', 'no job runs found');
  }
  sk('ce-jobs', 'ce_create_job',     'would create a real job (run manually)');
  sk('ce-jobs', 'ce_create_job_run', 'depends on ce_create_job');
  sk('ce-jobs', 'ce_delete_job',     'destructive (run manually)');
  sk('ce-jobs', 'ce_delete_job_run', 'destructive (run manually)');
  console.log();

  // ── 🔐 CE Secrets & ConfigMaps (8) ───────────────────────────────
  console.log('── 🔐  Code Engine: Secrets & ConfigMaps ───────────────────────');
  const secretsResp = await callTool('ce_list_secrets', { project_id: projectId });
  ok('ce-secrets', 'ce_list_secrets', secretsResp);
  const configMapsResp = await callTool('ce_list_config_maps', { project_id: projectId });
  ok('ce-configmaps', 'ce_list_config_maps', configMapsResp);

  const secretName = extractFirst(secretsResp, 'secrets');
  if (secretName) {
    ok('ce-secrets', 'ce_get_secret', await callTool('ce_get_secret', { project_id: projectId, secret_name: secretName }));
  } else {
    sk('ce-secrets', 'ce_get_secret', 'no secrets found');
  }
  const configMapName = extractFirst(configMapsResp, 'config_maps');
  if (configMapName) {
    ok('ce-configmaps', 'ce_get_config_map', await callTool('ce_get_config_map', { project_id: projectId, config_map_name: configMapName }));
  } else {
    sk('ce-configmaps', 'ce_get_config_map', 'no configmaps found');
  }
  sk('ce-secrets',    'ce_create_secret',    'would create a real secret (run manually)');
  sk('ce-configmaps', 'ce_create_config_map', 'would create a real configmap (run manually)');
  sk('ce-secrets',    'ce_delete_secret',     'destructive (run manually)');
  sk('ce-configmaps', 'ce_delete_config_map',  'destructive (run manually)');
  console.log();

  summary();
}

function summary() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Results:  ✅ ${pass} passed  ❌ ${fail} failed  ⚠️  ${skip} skipped`);
  console.log('═══════════════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
