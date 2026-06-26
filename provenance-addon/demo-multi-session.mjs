// Demo: multi-session receipt generator simulating two AI chat threads
// with multiple tasks per thread, including errors and recovery paths.
//
// Session A: "Deploy my app to Code Engine" — one user prompt, many tool calls
// Session B: "Fix the broken deployment and scale it" — follow-up chat
//
// Run: node provenance-addon/demo-multi-session.mjs
// Output: provenance-addon/receipts/multi-session-demo/

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLocalSigner, buildSignedReceipt, newEventId } from './receipt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'receipts', 'multi-session-demo');
mkdirSync(OUT_DIR, { recursive: true });

const signer = createLocalSigner();

// ── Session structure ────────────────────────────────────────────
// Session A: user says "Deploy my app to Code Engine"
//   Task A1: "Build and push the image" (user's initial intent parsed as sub-goal)
//   Task A2: "Deploy to Code Engine project" (second sub-goal from same prompt)
//   Task A3: "Verify deployment is live" (final sub-goal)
//
// Session B: user says "It's broken — the app shows 502. Fix it and scale to 5 instances"
//   Task B1: "Diagnose the failure" (AI checks app status, logs)
//   Task B2: "Fix and redeploy" (AI identifies env var issue, updates app)
//   Task B3: "Scale the application" (AI scales as requested)

const SESSION_A = 'session:chat-a-deploy-20260626-2030';
const SESSION_B = 'session:chat-b-fix-scale-20260626-2115';
const GIT_REF = 'main@e4f5a6b';
const LINEAGE_REF = 'workflow:ci-run-4521';
const PROJECT_ID = 'proj-prod-ca-tor-0042';
const NAMESPACE = 'mvk-code-engine';
const IMAGE = `us.icr.io/${NAMESPACE}/mywebapp:v2.1.0`;
const APP_NAME = 'mywebapp';

let baseMs = new Date('2026-06-26T20:30:00.000Z').getTime();
let tick = 0;
function nextTs(offset = 12) { tick += offset; return new Date(baseMs + tick * 1000).toISOString(); }
function save(receipt, name, ts) {
  const safe = name.replace(/[^a-z0-9_.-]/gi, '_');
  const fileName = `${ts.replace(/[:.]/g, '-')}-${safe}.json`;
  writeFileSync(join(OUT_DIR, fileName), JSON.stringify(receipt, null, 2), 'utf8');
  return fileName;
}

function emit({ session, task, tool, action, status, target, input, output, error, artifact, offset }) {
  const timestamp = nextTs(offset ?? 12);
  const event = {
    event_version: '0.1',
    event_id: newEventId(),
    timestamp,
    tool_name: tool,
    action_type: action,
    status,
    target_ref: target,
    session_id: session,
    task_id: task,
    trace_ref: session,
    git_ref: GIT_REF,
    lineage_ref: LINEAGE_REF,
    ...(artifact ? { artifact_content: artifact } : {}),
    input,
    ...(status === 'executed' ? { output } : { error }),
  };
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, `${task}-${tool}${status === 'failed' ? '-FAILED' : ''}`, timestamp);
  const icon = status === 'failed' ? '❌' : '✅';
  console.log(`${icon} [${task}] ${tool} → ${file}`);
  return { receipt, file, timestamp };
}

console.log('═══════════════════════════════════════════════════');
console.log('SESSION A: "Deploy my app to Code Engine"');
console.log('═══════════════════════════════════════════════════\n');

// ── Task A1: Build and push ──────────────────────────────────────
console.log('── Task A1: Build and push the image ──');
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'detect_container_runtime', action: 'detect_container_runtime',
  status: 'executed', target: 'runtime:local',
  input: {},
  output: { runtime: 'podman', version: '5.3.1', path: '/opt/homebrew/bin/podman' },
  offset: 3,
});
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'ce_validate_dockerfile', action: 'validate_dockerfile',
  status: 'executed', target: 'path:./Dockerfile',
  input: { dockerfile_path: './Dockerfile', expected_port: 8080 },
  output: { valid: true, checks: { architecture: 'ok', port: 'ok', nginx_sed: 'ok', user: 'ok', cmd: 'ok' } },
  offset: 5,
});
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'build_container_image', action: 'build_container_image',
  status: 'executed', target: `image:${IMAGE}`,
  artifact: 'FROM node:20-slim\nCOPY . /app\nRUN npm ci --production\nEXPOSE 8080\nCMD ["node","server.js"]',
  input: { dockerfile_path: './Dockerfile', image_name: IMAGE, platform: 'linux/amd64' },
  output: { success: true, image_id: 'sha256:c3d4e5f6a7b8' },
  offset: 35,
});
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'push_container_image', action: 'push_container_image',
  status: 'failed', target: `image:${IMAGE}`,
  input: { image_name: IMAGE, runtime: 'podman' },
  error: { name: 'PushError', message: 'denied: you have exceeded your storage quota for namespace mvk-code-engine', code: 'QUOTA_EXCEEDED' },
  offset: 8,
});
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'icr_list_images', action: 'icr_list_images',
  status: 'executed', target: `namespace:${NAMESPACE}`,
  input: { namespace: NAMESPACE, region: 'us-south' },
  output: { images: ['mywebapp:v1.0.0', 'mywebapp:v2.0.0', 'mywebapp:v2.0.1-beta', 'old-service:v0.1.0'], total: 4 },
  offset: 4,
});
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'icr_delete_image', action: 'icr_delete_image',
  status: 'executed', target: `image:us.icr.io/${NAMESPACE}/old-service:v0.1.0`,
  input: { image: `us.icr.io/${NAMESPACE}/old-service:v0.1.0`, region: 'us-south' },
  output: { deleted: true },
  offset: 6,
});
emit({
  session: SESSION_A, task: 'A1-build-push',
  tool: 'push_container_image', action: 'push_container_image',
  status: 'executed', target: `image:${IMAGE}`,
  input: { image_name: IMAGE, runtime: 'podman' },
  output: { success: true, digest: 'sha256:a1b2c3d4e5f6' },
  offset: 18,
});

// ── Task A2: Deploy ──────────────────────────────────────────────
console.log('\n── Task A2: Deploy to Code Engine ──');
emit({
  session: SESSION_A, task: 'A2-deploy',
  tool: 'ce_list_projects', action: 'ce_list_projects',
  status: 'executed', target: 'region:ca-tor',
  input: {},
  output: { projects: [{ id: PROJECT_ID, name: 'prod-toronto', status: 'active' }] },
  offset: 4,
});
emit({
  session: SESSION_A, task: 'A2-deploy',
  tool: 'ce_create_secret', action: 'ce_create_secret',
  status: 'executed', target: `secret:icr-pull-secret@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, name: 'icr-pull-secret', format: 'registry', data: { username: 'iamapikey', password: '<redacted>', server: 'us.icr.io' } },
  output: { name: 'icr-pull-secret', format: 'registry', created_at: '2026-06-26T20:36:00Z' },
  offset: 5,
});
emit({
  session: SESSION_A, task: 'A2-deploy',
  tool: 'ce_create_application', action: 'ce_create_application',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, name: APP_NAME, image: IMAGE, image_secret: 'icr-pull-secret', port: 8080, scale_min_instances: 1 },
  output: { name: APP_NAME, status: 'deploying', endpoint: `https://${APP_NAME}.${PROJECT_ID}.ca-tor.codeengine.appdomain.cloud` },
  offset: 6,
});
emit({
  session: SESSION_A, task: 'A2-deploy',
  tool: 'ce_wait_for_app_ready', action: 'ce_wait_for_app_ready',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME, timeout_seconds: 120 },
  output: { app_name: APP_NAME, status: 'ready', elapsed_seconds: 42, endpoint: `https://${APP_NAME}.${PROJECT_ID}.ca-tor.codeengine.appdomain.cloud` },
  offset: 45,
});

// ── Task A3: Verify ──────────────────────────────────────────────
console.log('\n── Task A3: Verify deployment ──');
emit({
  session: SESSION_A, task: 'A3-verify',
  tool: 'ce_list_app_instances', action: 'ce_list_app_instances',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME },
  output: { instances: [{ name: `${APP_NAME}-00001-dep-xyz1`, revision: `${APP_NAME}-00001`, status: 'running', restart_count: 0 }] },
  offset: 5,
});

// ── SESSION B ────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════');
console.log('SESSION B: "Fix the broken app and scale to 5"');
console.log('═══════════════════════════════════════════════════\n');

// Jump forward in time — new chat session 45 min later
tick += 2700;

// ── Task B1: Diagnose ────────────────────────────────────────────
console.log('── Task B1: Diagnose the 502 error ──');
emit({
  session: SESSION_B, task: 'B1-diagnose',
  tool: 'ce_get_application', action: 'ce_get_application',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME },
  output: { name: APP_NAME, status: 'ready', image_reference: IMAGE, endpoint: `https://${APP_NAME}.${PROJECT_ID}.ca-tor.codeengine.appdomain.cloud`, scale_min_instances: 1 },
  offset: 3,
});
emit({
  session: SESSION_B, task: 'B1-diagnose',
  tool: 'ce_list_app_instances', action: 'ce_list_app_instances',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME },
  output: { instances: [{ name: `${APP_NAME}-00001-dep-xyz1`, revision: `${APP_NAME}-00001`, status: 'running', restart_count: 14 }] },
  offset: 4,
});
emit({
  session: SESSION_B, task: 'B1-diagnose',
  tool: 'ce_get_app_logs', action: 'ce_get_app_logs',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}/instance:${APP_NAME}-00001-dep-xyz1`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME, instance_name: `${APP_NAME}-00001-dep-xyz1` },
  output: { logs: 'Error: DATABASE_URL is not set\n  at connectDB (/app/db.js:12:11)\n  at start (/app/server.js:8:3)\nProcess exited with code 1' },
  offset: 5,
});

// ── Task B2: Fix and redeploy ────────────────────────────────────
console.log('\n── Task B2: Fix missing env var and redeploy ──');
emit({
  session: SESSION_B, task: 'B2-fix-redeploy',
  tool: 'ce_update_application', action: 'ce_update_application',
  status: 'failed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME, env_vars: [{ name: 'DATABASE_URL', value: '<redacted>' }] },
  error: { name: 'ApiError', message: 'project quota limit reached: max_env_vars_per_app is 50, current is 50', code: 'QUOTA_ENV_VARS' },
  offset: 4,
});
emit({
  session: SESSION_B, task: 'B2-fix-redeploy',
  tool: 'ce_get_application', action: 'ce_get_application',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME },
  output: { name: APP_NAME, env_vars: Array.from({ length: 50 }, (_, i) => ({ name: `VAR_${i}`, value: '...' })) },
  offset: 3,
});
emit({
  session: SESSION_B, task: 'B2-fix-redeploy',
  tool: 'ce_update_application', action: 'ce_update_application',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME, env_vars: [{ name: 'UNUSED_VAR_49', value: null }, { name: 'DATABASE_URL', value: '<redacted>' }] },
  output: { name: APP_NAME, status: 'deploying', latest_created_revision: `${APP_NAME}-00002` },
  offset: 5,
});
emit({
  session: SESSION_B, task: 'B2-fix-redeploy',
  tool: 'ce_wait_for_app_ready', action: 'ce_wait_for_app_ready',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME, timeout_seconds: 120 },
  output: { app_name: APP_NAME, status: 'ready', elapsed_seconds: 28, endpoint: `https://${APP_NAME}.${PROJECT_ID}.ca-tor.codeengine.appdomain.cloud` },
  offset: 30,
});

// ── Task B3: Scale ───────────────────────────────────────────────
console.log('\n── Task B3: Scale to 5 instances ──');
emit({
  session: SESSION_B, task: 'B3-scale',
  tool: 'ce_update_application', action: 'ce_update_application',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME, scale_min_instances: 5, scale_max_instances: 10, scale_cpu_limit: '1', scale_memory_limit: '2G' },
  output: { name: APP_NAME, status: 'deploying', scale_min_instances: 5, scale_max_instances: 10, latest_created_revision: `${APP_NAME}-00003` },
  offset: 4,
});
emit({
  session: SESSION_B, task: 'B3-scale',
  tool: 'ce_list_app_instances', action: 'ce_list_app_instances',
  status: 'executed', target: `app:${APP_NAME}@${PROJECT_ID}`,
  input: { project_id: PROJECT_ID, app_name: APP_NAME },
  output: { instances: Array.from({ length: 5 }, (_, i) => ({ name: `${APP_NAME}-00003-dep-n${i+1}`, revision: `${APP_NAME}-00003`, status: 'running', restart_count: 0 })) },
  offset: 25,
});

console.log('\n✅ Multi-session demo complete.');
console.log(`   Output: ${OUT_DIR}`);
console.log('   Session A: 12 receipts (1 failure: ICR quota exceeded → cleaned old images → retried)');
console.log('   Session B: 8 receipts (1 failure: env var quota → removed unused var → retried)');
