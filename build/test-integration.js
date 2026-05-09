#!/usr/bin/env tsx
/**
 * test-integration.ts — Full integration tests for all 27 previously-skipped tools
 * Covers: container CRUD, CE secret/configmap/job/build/application lifecycles
 * Author: Markus van Kempen | markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
 *
 * Usage:
 *   npx tsx src/test-integration.ts
 *
 * Optional env vars:
 *   PUSH_IMAGE=us.icr.io/mynamespace/test:v1   — enables push_container_image test
 *   CE_PROJECT_ID=<uuid>                        — override project (default: first found)
 */
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });
dotenv.config({ path: join(__dirname, '../.env') });
// ── Helpers ────────────────────────────────────────────────────────────────
const SERVER = join(__dirname, '../build/index.js');
const HELLO_WORLD_APP = join(__dirname, '../../examples/apps/hello-world-app');
const PUBLIC_IMAGE = 'icr.io/codeengine/helloworld';
const TS = Date.now();
const uniq = (prefix) => `${prefix}-${TS}`;
// Detect available container runtime (podman preferred over docker)
function detectRuntime() {
    for (const rt of ['podman', 'docker']) {
        try {
            execSync(`which ${rt}`, { stdio: 'ignore' });
            return rt;
        }
        catch { /* not found */ }
    }
    return null;
}
const RUNTIME = detectRuntime();
let pass = 0, fail = 0, skip = 0;
function ok(group, tool, result) {
    const parsed = typeof result === 'string' ? tryParse(result) : result;
    if (parsed?.isError) {
        console.log(`  ❌  FAIL  [${group}] ${tool}`);
        console.log(`         → ${JSON.stringify(parsed).slice(0, 120)}`);
        fail++;
    }
    else {
        console.log(`  ✅  PASS  [${group}] ${tool}`);
        pass++;
    }
    return parsed;
}
function failWith(group, tool, err) {
    console.log(`  ❌  FAIL  [${group}] ${tool} — ${err?.message || err}`);
    fail++;
}
function sk(group, tool, reason) {
    console.log(`  ⚠️   SKIP  [${group}] ${tool} — ${reason}`);
    skip++;
}
function tryParse(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return s;
    }
}
function extractText(result) {
    if (result?.content?.[0]?.text)
        return result.content[0].text;
    return typeof result === 'string' ? result : JSON.stringify(result);
}
function parseToolResult(result) {
    const text = extractText(result);
    return tryParse(text);
}
// Spawn a fresh server, call one tool, return parsed result
function callTool(toolName, toolArgs) {
    return new Promise((resolve, reject) => {
        const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`Timeout calling ${toolName}`));
        }, 60_000);
        proc.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
            for (const line of stdout.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) {
                        clearTimeout(timer);
                        proc.kill('SIGTERM');
                        if (parsed.error) {
                            resolve({ isError: true, ...parsed.error });
                        }
                        else {
                            resolve(parsed.result);
                        }
                        return;
                    }
                }
                catch { /* not JSON yet */ }
            }
        });
        proc.on('error', (err) => { clearTimeout(timer); reject(err); });
        const req = JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: toolName, arguments: toolArgs },
        });
        proc.stdin?.write(req + '\n');
    });
}
// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  IBM Code Engine MCP Server — Integration Tests (27 tools)');
    console.log(`  Server: ${SERVER}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log();
    // ── Resolve project ID & region ─────────────────────────────────────────
    const projectId = process.env.CE_PROJECT_ID || await (async () => {
        const r = await callTool('ce_list_projects', {});
        const data = parseToolResult(r);
        const p = data?.projects?.[0] || data?.allProjects?.[0];
        return p?.id ?? null;
    })();
    if (!projectId) {
        console.error('No project found — set CE_PROJECT_ID');
        process.exit(1);
    }
    const projectData = parseToolResult(await callTool('ce_get_project', { project_id: projectId }));
    const region = projectData?.region ?? 'us-south';
    console.log(`  Project: ${projectId}  Region: ${region}`);
    if (RUNTIME)
        console.log(`  Container runtime: ${RUNTIME}`);
    else
        console.log('  Container runtime: none detected — container tests will be skipped');
    console.log();
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1 — Container Tools
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── 🐳  Container Tools ──────────────────────────────────────');
    if (!RUNTIME) {
        sk('container', 'build_container_image', 'no container runtime (docker/podman) found');
        sk('container', 'test_container_locally', 'no container runtime found');
        sk('container', 'get_container_logs', 'no container runtime found');
        sk('container', 'stop_local_container', 'no container runtime found');
        sk('container', 'push_container_image', 'no container runtime found');
        console.log();
    }
    else {
        const imageName = `test-mcp-hello:${TS}`;
        let containerId = null;
        let imageBuildPassed = false;
        // build_container_image
        try {
            const buildResult = await callTool('build_container_image', {
                dockerfile_path: `${HELLO_WORLD_APP}/Dockerfile`,
                image_name: imageName,
                context_path: HELLO_WORLD_APP,
                runtime: RUNTIME,
            });
            const parsed = ok('container', 'build_container_image', buildResult);
            imageBuildPassed = !parsed?.isError;
        }
        catch (e) {
            failWith('container', 'build_container_image', e);
        }
        // test_container_locally — run the just-built image
        if (imageBuildPassed) {
            try {
                const runResult = await callTool('test_container_locally', {
                    image_name: imageName,
                    port_mapping: '18080:8000',
                    runtime: RUNTIME,
                });
                const parsed = ok('container', 'test_container_locally', runResult);
                containerId = parseToolResult(runResult)?.container_id ?? null;
                if (!parsed?.isError && !containerId) {
                    // some runtimes return just the ID as text
                    containerId = extractText(runResult).trim().split('\n').pop() ?? null;
                }
            }
            catch (e) {
                failWith('container', 'test_container_locally', e);
            }
        }
        else {
            sk('container', 'test_container_locally', 'image build failed');
        }
        // get_container_logs
        if (containerId) {
            try {
                ok('container', 'get_container_logs', await callTool('get_container_logs', { container_id: containerId, runtime: RUNTIME }));
            }
            catch (e) {
                failWith('container', 'get_container_logs', e);
            }
        }
        else {
            sk('container', 'get_container_logs', 'no container running');
        }
        // stop_local_container — always attempt cleanup
        if (containerId) {
            try {
                ok('container', 'stop_local_container', await callTool('stop_local_container', { container_id: containerId, runtime: RUNTIME }));
            }
            catch (e) {
                failWith('container', 'stop_local_container', e);
            }
        }
        else {
            sk('container', 'stop_local_container', 'no container to stop');
        }
        // push_container_image — only if PUSH_IMAGE set
        const pushImage = process.env.PUSH_IMAGE;
        if (pushImage) {
            try {
                ok('container', 'push_container_image', await callTool('push_container_image', { image_name: pushImage, runtime: RUNTIME }));
            }
            catch (e) {
                failWith('container', 'push_container_image', e);
            }
        }
        else {
            sk('container', 'push_container_image', 'set PUSH_IMAGE=<registry/image:tag> to enable');
        }
        console.log();
    } // end RUNTIME block
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — Secret lifecycle (create → get → delete)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── 🔐  CE Secret lifecycle ──────────────────────────────────');
    const secretName = uniq('test-secret');
    let secretCreated = false;
    try {
        const cr = await callTool('ce_create_secret', {
            project_id: projectId, name: secretName, format: 'generic',
            data: { greeting: 'aGVsbG8=', env: 'dGVzdA==' },
        });
        ok('ce-secret', 'ce_create_secret', cr);
        secretCreated = !parseToolResult(cr)?.isError;
        if (secretCreated) {
            ok('ce-secret', 'ce_get_secret', await callTool('ce_get_secret', { project_id: projectId, secret_name: secretName }));
        }
    }
    catch (e) {
        failWith('ce-secret', 'ce_create_secret / ce_get_secret', e);
    }
    finally {
        if (secretCreated) {
            try {
                ok('ce-secret', 'ce_delete_secret', await callTool('ce_delete_secret', { project_id: projectId, secret_name: secretName }));
            }
            catch (e) {
                failWith('ce-secret', 'ce_delete_secret', e);
            }
        }
    }
    console.log();
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3 — ConfigMap lifecycle (create → get → delete)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── 🗂️   CE ConfigMap lifecycle ──────────────────────────────');
    const configMapName = uniq('test-cm');
    let cmCreated = false;
    try {
        const cr = await callTool('ce_create_config_map', {
            project_id: projectId, name: configMapName,
            data: { app_name: 'integration-test', version: '1.0.0', env: 'test' },
        });
        ok('ce-configmap', 'ce_create_config_map', cr);
        cmCreated = !parseToolResult(cr)?.isError;
        if (cmCreated) {
            ok('ce-configmap', 'ce_get_config_map', await callTool('ce_get_config_map', { project_id: projectId, config_map_name: configMapName }));
        }
    }
    catch (e) {
        failWith('ce-configmap', 'ce_create_config_map / ce_get_config_map', e);
    }
    finally {
        if (cmCreated) {
            try {
                ok('ce-configmap', 'ce_delete_config_map', await callTool('ce_delete_config_map', { project_id: projectId, config_map_name: configMapName }));
            }
            catch (e) {
                failWith('ce-configmap', 'ce_delete_config_map', e);
            }
        }
    }
    console.log();
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4 — Build config lifecycle (create → get → delete)
    //           Uses Code Engine auto-managed ICR — no external registry needed
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── 🏗️   CE Build lifecycle ──────────────────────────────────');
    const buildName = uniq('test-build');
    const outputImage = `private.${region}.icr.io/${projectId}/${buildName}:latest`;
    const outputSecret = `ce-auto-icr-private-${region}`;
    let buildCreated = false;
    try {
        const cr = await callTool('ce_create_build', {
            project_id: projectId, name: buildName,
            output_image: outputImage, output_secret: outputSecret,
            source_type: 'local', strategy_type: 'dockerfile', strategy_size: 'small',
        });
        ok('ce-build', 'ce_create_build', cr);
        buildCreated = !parseToolResult(cr)?.isError;
        if (buildCreated) {
            ok('ce-build', 'ce_get_build', await callTool('ce_get_build', { project_id: projectId, build_name: buildName }));
            // Build run: create, get status, delete — don't wait for full build completion
            const runName = uniq('test-run');
            let runCreated = false;
            try {
                const runCr = await callTool('ce_create_build_run', { project_id: projectId, build_name: buildName, name: runName });
                ok('ce-build', 'ce_create_build_run', runCr);
                runCreated = !parseToolResult(runCr)?.isError;
                if (runCreated) {
                    ok('ce-build', 'ce_get_build_run', await callTool('ce_get_build_run', { project_id: projectId, build_run_name: runName }));
                }
            }
            catch (e) {
                failWith('ce-build', 'ce_create_build_run', e);
            }
            finally {
                if (runCreated) {
                    try {
                        ok('ce-build', 'ce_delete_build_run', await callTool('ce_delete_build_run', { project_id: projectId, build_run_name: runName }));
                    }
                    catch (e) {
                        failWith('ce-build', 'ce_delete_build_run', e);
                    }
                }
            }
        }
    }
    catch (e) {
        failWith('ce-build', 'ce_create_build', e);
    }
    finally {
        if (buildCreated) {
            try {
                ok('ce-build', 'ce_delete_build', await callTool('ce_delete_build', { project_id: projectId, build_name: buildName }));
            }
            catch (e) {
                failWith('ce-build', 'ce_delete_build', e);
            }
        }
    }
    console.log();
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5 — Job lifecycle (create → get → job_run → get_run → delete)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── ⚙️   CE Job lifecycle ─────────────────────────────────────');
    const jobName = uniq('test-job');
    let jobCreated = false;
    let jobRunName = null;
    let jobRunCreated = false;
    try {
        const cr = await callTool('ce_create_job', {
            project_id: projectId, name: jobName, image: PUBLIC_IMAGE,
            scale_array_spec: '0', scale_cpu_limit: '0.25', scale_memory_limit: '0.5G',
        });
        ok('ce-job', 'ce_create_job', cr);
        jobCreated = !parseToolResult(cr)?.isError;
        if (jobCreated) {
            ok('ce-job', 'ce_get_job', await callTool('ce_get_job', { project_id: projectId, job_name: jobName }));
            // Submit a job run
            jobRunName = uniq('test-jrun');
            try {
                const runCr = await callTool('ce_create_job_run', { project_id: projectId, job_name: jobName, name: jobRunName });
                ok('ce-job', 'ce_create_job_run', runCr);
                jobRunCreated = !parseToolResult(runCr)?.isError;
                if (jobRunCreated) {
                    ok('ce-job', 'ce_get_job_run', await callTool('ce_get_job_run', { project_id: projectId, job_run_name: jobRunName }));
                }
            }
            catch (e) {
                failWith('ce-job', 'ce_create_job_run', e);
            }
        }
    }
    catch (e) {
        failWith('ce-job', 'ce_create_job', e);
    }
    finally {
        if (jobRunCreated && jobRunName) {
            try {
                ok('ce-job', 'ce_delete_job_run', await callTool('ce_delete_job_run', { project_id: projectId, job_run_name: jobRunName }));
            }
            catch (e) {
                failWith('ce-job', 'ce_delete_job_run', e);
            }
        }
        if (jobCreated) {
            try {
                ok('ce-job', 'ce_delete_job', await callTool('ce_delete_job', { project_id: projectId, job_name: jobName }));
            }
            catch (e) {
                failWith('ce-job', 'ce_delete_job', e);
            }
        }
    }
    console.log();
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6 — Application lifecycle (create → update → instances → logs → delete)
    //           Uses public helloworld image — no registry auth needed
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── 🚀  CE Application lifecycle ─────────────────────────────');
    const appName = uniq('test-app');
    let appCreated = false;
    try {
        const cr = await callTool('ce_create_application', {
            project_id: projectId, name: appName, image: PUBLIC_IMAGE,
            port: 8080, scale_min_instances: 0, scale_max_instances: 2,
            scale_cpu_limit: '0.25', scale_memory_limit: '0.5G',
        });
        ok('ce-app', 'ce_create_application', cr);
        appCreated = !parseToolResult(cr)?.isError;
        if (appCreated) {
            // update
            ok('ce-app', 'ce_update_application', await callTool('ce_update_application', {
                project_id: projectId, app_name: appName, scale_max_instances: 3,
            }));
            // list instances — likely empty right after creation (scale-to-zero)
            const instResult = await callTool('ce_list_app_instances', { project_id: projectId, app_name: appName });
            ok('ce-app', 'ce_list_app_instances', instResult);
            // get_app_logs — CE REST API v2 returns 403; handler converts to informational note
            const instances = parseToolResult(instResult)?.instances ?? [];
            if (instances.length > 0) {
                try {
                    const logsResult = await callTool('ce_get_app_logs', {
                        project_id: projectId, app_name: appName, instance_name: instances[0].name,
                    });
                    // handler converts 403 to an informational note — treat as pass
                    ok('ce-app', 'ce_get_app_logs', logsResult);
                }
                catch (e) {
                    failWith('ce-app', 'ce_get_app_logs', e);
                }
            }
            else {
                sk('ce-app', 'ce_get_app_logs', 'app scaled to zero — no instances running');
            }
        }
    }
    catch (e) {
        failWith('ce-app', 'ce_create_application', e);
    }
    finally {
        if (appCreated) {
            try {
                ok('ce-app', 'ce_delete_application', await callTool('ce_delete_application', { project_id: projectId, app_name: appName }));
            }
            catch (e) {
                failWith('ce-app', 'ce_delete_application', e);
            }
        }
    }
    console.log();
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 7 — Project create/delete: SKIP (slow, costly, production-risky)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('── ☁️   CE Project create/delete ─────────────────────────────');
    sk('ce-projects', 'ce_create_project', 'skipped — slow provisioning, production-risky');
    sk('ce-projects', 'ce_delete_project', 'skipped — destructive');
    console.log();
    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Results:  ✅ ${pass} passed  ❌ ${fail} failed  ⚠️  ${skip} skipped`);
    console.log('═══════════════════════════════════════════════════════════');
    process.exit(fail > 0 ? 1 : 0);
}
main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=test-integration.js.map