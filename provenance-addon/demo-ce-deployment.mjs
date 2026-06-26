// Demo receipt generator: realistic IBM Code Engine deployment flow.
// Produces a sequence of signed receipts covering the full agentic pipeline:
//   validate → build → push (fail) → fix auth → push → deploy →
//   wait (fail: image pull) → fix pull secret → redeploy → wait (ok) →
//   set env vars → scale up → list instances
//
// Run: node provenance-addon/demo-ce-deployment.mjs
// Output: provenance-addon/receipts/ce-deployment-demo/
//
// Note: uses an ephemeral local signer — receipts are not cross-run verifiable.
// This is a demo/PoC flow for visualizer testing only.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLocalSigner, buildSignedReceipt, newEventId } from './receipt.mjs';
import { hashRaw } from './canonical.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'receipts', 'ce-deployment-demo');
mkdirSync(OUT_DIR, { recursive: true });

const signer = createLocalSigner();

// Shared session context — all receipts share the same trace and git refs.
const SESSION_TRACE = 'trace:ce-deploy-session-demo-001';
const GIT_REF = 'feature/add-splash-app@a1b2c3d';
const LINEAGE_REF = 'workflow:github-actions-run-9912';
const NAMESPACE = 'mvk-code-engine';
const PROJECT_ID = 'proj-demo-ca-tor-0001';
const IMAGE = `us.icr.io/${NAMESPACE}/developer-splash:v1.0.0`;

// Base timestamp — each step is ~10-30 seconds apart for realism.
const BASE_MS = new Date('2026-06-26T20:30:00.000Z').getTime();
let tick = 0;
function nextTs(offsetSeconds = 15) {
  tick += offsetSeconds;
  return new Date(BASE_MS + tick * 1000).toISOString();
}

function save(receipt, stepName, timestamp) {
  const safe = stepName.replace(/[^a-z0-9_.-]/gi, '_');
  const ts = timestamp.replace(/[:.]/g, '-');
  const fileName = `${ts}-${safe}.json`;
  writeFileSync(join(OUT_DIR, fileName), JSON.stringify(receipt, null, 2), 'utf8');
  return fileName;
}

function makeEvent({ tool, action, status, targetRef, input, output, error, artifactContent, offsetSeconds }) {
  const timestamp = nextTs(offsetSeconds ?? 15);
  return {
    event: {
      event_version: '0.1',
      event_id: newEventId(),
      timestamp,
      tool_name: tool,
      action_type: action,
      status,
      target_ref: targetRef,
      trace_ref: SESSION_TRACE,
      git_ref: GIT_REF,
      lineage_ref: LINEAGE_REF,
      ...(artifactContent ? { artifact_content: artifactContent } : {}),
      input,
      ...(status === 'executed' ? { output } : { error }),
    },
    timestamp,
  };
}

const steps = [];

// 1. Validate Dockerfile — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_validate_dockerfile',
    action: 'validate_dockerfile',
    status: 'executed',
    targetRef: 'path:examples/developer-splash/Dockerfile',
    input: { dockerfile_path: 'examples/developer-splash/Dockerfile', expected_port: 8080 },
    output: { valid: true, checks: { architecture: 'ok', port: 'ok', nginx_sed: 'ok', user: 'ok', cmd: 'ok' } },
    offsetSeconds: 5,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 1, label: 'Validate Dockerfile', status: 'executed', file, timestamp });
  console.log('✅ step 1:', file);
}

// 2. Build container image — success
{
  const rawArtifact = 'STEP 1/5: FROM nginx:alpine\nSTEP 2/5: COPY index.html\nSuccessfully built a1b2c3d4';
  const { event, timestamp } = makeEvent({
    tool: 'build_container_image',
    action: 'build_container_image',
    status: 'executed',
    targetRef: `image:${IMAGE}`,
    artifactContent: rawArtifact,
    input: { dockerfile_path: 'examples/developer-splash/Dockerfile', image_name: IMAGE, platform: 'linux/amd64' },
    output: { success: true, image_id: 'sha256:a1b2c3d4e5f6', build_output: '<redacted>' },
    offsetSeconds: 28,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 2, label: 'Build Image', status: 'executed', file, timestamp });
  console.log('✅ step 2:', file);
}

// 3. Push container image — FAILED (token expired)
{
  const { event, timestamp } = makeEvent({
    tool: 'push_container_image',
    action: 'push_container_image',
    status: 'failed',
    targetRef: `image:${IMAGE}`,
    input: { image_name: IMAGE, runtime: 'podman' },
    error: { name: 'PushError', message: 'unauthorized: authentication required — IAM token may be expired', code: 'UNAUTHORIZED' },
    offsetSeconds: 8,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name + '-FAILED', timestamp);
  steps.push({ step: 3, label: 'Push Image', status: 'failed', file, timestamp, issue: 'ICR token expired — re-login required before push can proceed.' });
  console.log('❌ step 3:', file);
}

// 4. Re-authenticate / IAM token refresh — success
{
  const { event, timestamp } = makeEvent({
    tool: 'iam_get_token_info',
    action: 'iam_token_refresh',
    status: 'executed',
    targetRef: 'iam:token',
    input: { api_key: '<redacted>' },
    output: { token_valid: true, account_id: 'acct-demo-001', expiry: nextTs(3599) },
    offsetSeconds: 6,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 4, label: 'IAM Token Refresh', status: 'executed', file, timestamp });
  console.log('✅ step 4:', file);
}

// 5. Push container image — success (retry after token refresh)
{
  const { event, timestamp } = makeEvent({
    tool: 'push_container_image',
    action: 'push_container_image',
    status: 'executed',
    targetRef: `image:${IMAGE}`,
    input: { image_name: IMAGE, runtime: 'podman' },
    output: { success: true, digest: 'sha256:f9a8b7c6d5e4', output: 'Writing manifest to image destination' },
    offsetSeconds: 22,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 5, label: 'Push Image (retry)', status: 'executed', file, timestamp });
  console.log('✅ step 5:', file);
}

// 6. Create ICR pull secret — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_create_secret',
    action: 'ce_create_secret',
    status: 'executed',
    targetRef: `secret:icr-pull-secret@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, name: 'icr-pull-secret', format: 'registry', data: { username: 'iamapikey', password: '<redacted>', server: 'us.icr.io', email: 'user@example.com' } },
    output: { name: 'icr-pull-secret', format: 'registry', resource_type: 'secret_registry_v2', created_at: nextTs(2) },
    offsetSeconds: 5,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 6, label: 'Create Pull Secret', status: 'executed', file, timestamp });
  console.log('✅ step 6:', file);
}

// 7. Deploy application — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_create_application',
    action: 'ce_create_application',
    status: 'executed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, name: 'developer-splash', image: IMAGE, image_secret: 'icr-pull-secret', port: 8080, scale_min_instances: 1, scale_max_instances: 3 },
    output: { name: 'developer-splash', status: 'deploying', image_reference: IMAGE, endpoint: `https://developer-splash.${PROJECT_ID}.ca-tor.codeengine.appdomain.cloud` },
    offsetSeconds: 8,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 7, label: 'Deploy Application', status: 'executed', file, timestamp });
  console.log('✅ step 7:', file);
}

// 8. Wait for app ready — FAILED (image pull backoff — pull secret name mismatch)
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_wait_for_app_ready',
    action: 'ce_wait_for_app_ready',
    status: 'failed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, app_name: 'developer-splash', timeout_seconds: 120 },
    error: { name: 'DeploymentTimeout', message: 'app stuck in "deploying" after 120s — latest revision not ready; reason: ImagePullBackOff — pull secret "icr-pull-secret" may not match the registry host', code: 'IMAGE_PULL_BACKOFF' },
    offsetSeconds: 125,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name + '-FAILED', timestamp);
  steps.push({ step: 8, label: 'Wait for Ready', status: 'failed', file, timestamp, issue: 'ImagePullBackOff — pull secret server field does not match ICR host. Refreshing pull secret to fix.' });
  console.log('❌ step 8:', file);
}

// 9. Refresh ICR pull secret — success (fix stale credentials)
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_refresh_icr_pull_secret',
    action: 'ce_refresh_icr_pull_secret',
    status: 'executed',
    targetRef: `secret:icr-pull-secret@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, secret_name: 'icr-pull-secret', icr_host: 'us.icr.io' },
    output: { refreshed: true, secret_name: 'icr-pull-secret', format: 'registry', updated_at: nextTs(2) },
    offsetSeconds: 7,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 9, label: 'Refresh Pull Secret', status: 'executed', file, timestamp });
  console.log('✅ step 9:', file);
}

// 10. Update application (force redeploy) — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_update_application',
    action: 'ce_update_application',
    status: 'executed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, app_name: 'developer-splash', image: IMAGE, image_secret: 'icr-pull-secret' },
    output: { name: 'developer-splash', status: 'deploying', latest_created_revision: 'developer-splash-00002' },
    offsetSeconds: 6,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name + '-redeploy', timestamp);
  steps.push({ step: 10, label: 'Update App (redeploy)', status: 'executed', file, timestamp });
  console.log('✅ step 10:', file);
}

// 11. Wait for app ready — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_wait_for_app_ready',
    action: 'ce_wait_for_app_ready',
    status: 'executed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, app_name: 'developer-splash', timeout_seconds: 120 },
    output: { app_name: 'developer-splash', status: 'ready', endpoint: `https://developer-splash.${PROJECT_ID}.ca-tor.codeengine.appdomain.cloud`, elapsed_seconds: 38 },
    offsetSeconds: 40,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 11, label: 'Wait for Ready', status: 'executed', file, timestamp });
  console.log('✅ step 11:', file);
}

// 12. Set environment variables — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_update_application',
    action: 'ce_update_application',
    status: 'executed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, app_name: 'developer-splash', env_vars: [{ name: 'APP_ENV', value: 'production' }, { name: 'LOG_LEVEL', value: 'info' }] },
    output: { name: 'developer-splash', status: 'deploying', latest_created_revision: 'developer-splash-00003' },
    offsetSeconds: 5,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name + '-env', timestamp);
  steps.push({ step: 12, label: 'Set Env Vars', status: 'executed', file, timestamp });
  console.log('✅ step 12:', file);
}

// 13. Scale up — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_update_application',
    action: 'ce_update_application',
    status: 'executed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, app_name: 'developer-splash', scale_min_instances: 2, scale_max_instances: 10, scale_cpu_limit: '1', scale_memory_limit: '2G' },
    output: { name: 'developer-splash', status: 'deploying', scale_min_instances: 2, scale_max_instances: 10, latest_created_revision: 'developer-splash-00004' },
    offsetSeconds: 5,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name + '-scale', timestamp);
  steps.push({ step: 13, label: 'Scale Up (2–10)', status: 'executed', file, timestamp });
  console.log('✅ step 13:', file);
}

// 14. List running instances — success
{
  const { event, timestamp } = makeEvent({
    tool: 'ce_list_app_instances',
    action: 'ce_list_app_instances',
    status: 'executed',
    targetRef: `app:developer-splash@${PROJECT_ID}`,
    input: { project_id: PROJECT_ID, app_name: 'developer-splash' },
    output: {
      instances: [
        { name: 'developer-splash-00004-deployment-abc1', revision: 'developer-splash-00004', status: 'running', restart_count: 0 },
        { name: 'developer-splash-00004-deployment-abc2', revision: 'developer-splash-00004', status: 'running', restart_count: 0 },
      ],
    },
    offsetSeconds: 18,
  });
  const receipt = buildSignedReceipt(event, signer);
  const file = save(receipt, event.tool_name, timestamp);
  steps.push({ step: 14, label: 'List Instances', status: 'executed', file, timestamp });
  console.log('✅ step 14:', file);
}

// Write session manifest — lists all steps in order for the visualizer
const manifest = {
  session_id: SESSION_TRACE,
  description: 'IBM Code Engine deployment: validate → build → push (fail/retry) → deploy → wait (fail/retry) → env vars → scale',
  generated_at: new Date().toISOString(),
  steps,
};
writeFileSync(join(OUT_DIR, '_session.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('\n📋 session manifest written to receipts/ce-deployment-demo/_session.json');
console.log(`\n✅ Generated ${steps.length} receipts in ${OUT_DIR}`);
console.log('   Failures at steps: 3 (push token expired), 8 (ImagePullBackOff)');
