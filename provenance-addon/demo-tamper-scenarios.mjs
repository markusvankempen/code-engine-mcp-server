// Demo: tamper detection scenarios for the visualizer.
// Generates valid signed receipts, then creates intentionally corrupted copies
// to demonstrate what happens when receipts are tampered with after signing.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Run: node provenance-addon/demo-tamper-scenarios.mjs
// Output: provenance-addon/receipts/tamper-demo/

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { buildSignedReceipt, newEventId, verifySignedReceipt } from './receipt.mjs';
import { hashRaw } from './canonical.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'receipts', 'tamper-demo');
mkdirSync(OUT_DIR, { recursive: true });

function createExportableSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyId = hashRaw(pubDer);

  return {
    publicKeyId,
    publicKeyDerBase64: pubDer.toString('base64'),
    sign(data) {
      return edSign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64');
    },
    verify(data, signatureB64) {
      return edVerify(null, Buffer.from(data, 'utf8'), publicKey, Buffer.from(signatureB64, 'base64'));
    },
  };
}

const exportableSigner = createExportableSigner();

const SESSION = 'session:tamper-demo-20260626';
const GIT_REF = 'main@d1e2f3a';

let baseMs = new Date('2026-06-26T22:00:00.000Z').getTime();
let tick = 0;
function nextTs(offset = 8) { tick += offset; return new Date(baseMs + tick * 1000).toISOString(); }

function makeEvent(overrides = {}) {
  return {
    event_version: '0.1',
    event_id: newEventId(),
    timestamp: nextTs(),
    tool_name: overrides.tool_name || 'ce_create_application',
    action_type: overrides.action_type || 'ce_create_application',
    status: overrides.status || 'executed',
    target_ref: overrides.target_ref || 'app:mywebapp@proj-prod-ca-tor',
    session_id: SESSION,
    task_id: overrides.task_id || 'deploy-task',
    trace_ref: SESSION,
    git_ref: GIT_REF,
    input: overrides.input || { project_id: 'proj-prod-ca-tor', app_name: 'mywebapp', image: 'us.icr.io/ns/mywebapp:v2' },
    ...(overrides.status === 'failed'
      ? { error: overrides.error || { name: 'ApiError', message: 'deployment failed' } }
      : { output: overrides.output || { name: 'mywebapp', status: 'ready', endpoint: 'https://mywebapp.ca-tor.codeengine.appdomain.cloud' } }),
  };
}

function save(obj, name) {
  const fileName = `${name}.json`;
  writeFileSync(join(OUT_DIR, fileName), JSON.stringify(obj, null, 2), 'utf8');
  return fileName;
}

// ── Generate receipts ────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════');
console.log('  TAMPER DETECTION DEMO');
console.log('═══════════════════════════════════════════════════\n');

// 1. Valid receipt — baseline
const validEvent1 = makeEvent({ tool_name: 'ce_validate_dockerfile', action_type: 'validate_dockerfile', target_ref: 'path:./Dockerfile', task_id: 'validate' });
const validReceipt1 = buildSignedReceipt(validEvent1, exportableSigner);
save(validReceipt1, '01-valid-validate-dockerfile');
const v1 = verifySignedReceipt(validReceipt1, exportableSigner);
console.log(`✅ 01 Valid receipt (validate_dockerfile): verify=${v1.ok}`);

// 2. Valid receipt — build
const validEvent2 = makeEvent({ tool_name: 'build_container_image', action_type: 'build_container_image', target_ref: 'image:us.icr.io/ns/mywebapp:v2', task_id: 'build' });
const validReceipt2 = buildSignedReceipt(validEvent2, exportableSigner);
save(validReceipt2, '02-valid-build-image');
const v2 = verifySignedReceipt(validReceipt2, exportableSigner);
console.log(`✅ 02 Valid receipt (build_image): verify=${v2.ok}`);

// 3. Valid receipt — deploy
const validEvent3 = makeEvent({ task_id: 'deploy' });
const validReceipt3 = buildSignedReceipt(validEvent3, exportableSigner);
save(validReceipt3, '03-valid-deploy-app');
const v3 = verifySignedReceipt(validReceipt3, exportableSigner);
console.log(`✅ 03 Valid receipt (deploy): verify=${v3.ok}`);

// 4. Valid FAILED receipt — tool failed but receipt is intact
const validEvent4 = makeEvent({ tool_name: 'push_container_image', action_type: 'push_container_image', status: 'failed', target_ref: 'image:us.icr.io/ns/mywebapp:v2', task_id: 'push', error: { name: 'PushError', message: 'UNAUTHORIZED: token expired', code: 'UNAUTHORIZED' } });
const validReceipt4 = buildSignedReceipt(validEvent4, exportableSigner);
save(validReceipt4, '04-valid-push-FAILED');
const v4 = verifySignedReceipt(validReceipt4, exportableSigner);
console.log(`✅ 04 Valid failed receipt (push_failed): verify=${v4.ok} (status=failed is expected)`);

// ── TAMPERED RECEIPTS ────────────────────────────────────────────
console.log('\n── Tampered receipts (should all fail verification) ──');

// 5. TAMPERED: target_ref changed (attacker hides which file was written)
const tampered5 = JSON.parse(JSON.stringify(validReceipt3));
tampered5.claim.target_ref = 'app:evil-app@attacker-project';
tampered5._tampered = { field: 'target_ref', original: validReceipt3.claim.target_ref, altered: tampered5.claim.target_ref, description: 'Attacker changed the deployment target to hide where the app was actually deployed' };
save(tampered5, '05-TAMPERED-target-ref-changed');
const t5 = verifySignedReceipt(tampered5, exportableSigner);
console.log(`⚠️  05 TAMPERED target_ref: verify=${t5.ok}, reason=${t5.reason}`);

// 6. TAMPERED: status flipped from "failed" to "executed" (attacker hides a failure)
const tampered6 = JSON.parse(JSON.stringify(validReceipt4));
tampered6.claim.status = 'executed';
tampered6._tampered = { field: 'status', original: 'failed', altered: 'executed', description: 'Attacker changed status from "failed" to "executed" to hide that the push actually failed' };
save(tampered6, '06-TAMPERED-status-flipped');
const t6 = verifySignedReceipt(tampered6, exportableSigner);
console.log(`⚠️  06 TAMPERED status flipped: verify=${t6.ok}, reason=${t6.reason}`);

// 7. TAMPERED: timestamp backdated (attacker changes when it happened)
const tampered7 = JSON.parse(JSON.stringify(validReceipt2));
tampered7.claim.timestamp = '2026-01-01T00:00:00.000Z';
tampered7._tampered = { field: 'timestamp', original: validReceipt2.claim.timestamp, altered: tampered7.claim.timestamp, description: 'Attacker backdated the receipt to January to mislead audit timeline' };
save(tampered7, '07-TAMPERED-timestamp-backdated');
const t7 = verifySignedReceipt(tampered7, exportableSigner);
console.log(`⚠️  07 TAMPERED timestamp backdated: verify=${t7.ok}, reason=${t7.reason}`);

// 8. TAMPERED: artifact_hash removed (attacker removes content binding)
const validEvent8 = makeEvent({ tool_name: 'workspace.write_or_modify_file', action_type: 'write_or_modify_file', target_ref: 'path:src/index.ts', task_id: 'write-file', artifact_content: 'export function main() { return 42; }\n' });
// Need to add artifact_content to the event
const event8withArtifact = { ...validEvent8, artifact_content: 'export function main() { return 42; }\n' };
const validReceipt8 = buildSignedReceipt(event8withArtifact, exportableSigner);
save(validReceipt8, '08-valid-write-file');
const v8 = verifySignedReceipt(validReceipt8, exportableSigner);
console.log(`✅ 08 Valid receipt (write_file with artifact_hash): verify=${v8.ok}`);

const tampered8 = JSON.parse(JSON.stringify(validReceipt8));
delete tampered8.claim.artifact_hash;
tampered8._tampered = { field: 'artifact_hash', original: validReceipt8.claim.artifact_hash, altered: '(removed)', description: 'Attacker removed the artifact_hash to break the binding between receipt and file content' };
save(tampered8, '09-TAMPERED-artifact-hash-removed');
const t8 = verifySignedReceipt(tampered8, exportableSigner);
console.log(`⚠️  09 TAMPERED artifact_hash removed: verify=${t8.ok}, reason=${t8.reason}`);

// 10. TAMPERED: signature replaced with random data (attacker tried to re-sign)
const tampered10 = JSON.parse(JSON.stringify(validReceipt1));
tampered10.signature = 'dGhpcyBpcyBub3QgYSByZWFsIHNpZ25hdHVyZSBidXQgaXQgbG9va3MgbGlrZSBiYXNlNjQ=';
tampered10._tampered = { field: 'signature', original: '(valid Ed25519 signature)', altered: '(random base64 data)', description: 'Attacker replaced the signature with fake data — they do not have the private key' };
save(tampered10, '10-TAMPERED-forged-signature');
const t10 = verifySignedReceipt(tampered10, exportableSigner);
console.log(`⚠️  10 TAMPERED forged signature: verify=${t10.ok}, reason=${t10.reason}`);

// 11. TAMPERED: tool_name changed (attacker disguises which tool ran)
const tampered11 = JSON.parse(JSON.stringify(validReceipt3));
tampered11.claim.tool_name = 'ce_delete_application';
tampered11.claim.action_type = 'ce_delete_application';
tampered11._tampered = { field: 'tool_name', original: 'ce_create_application', altered: 'ce_delete_application', description: 'Attacker changed the tool name to disguise a create as a delete' };
save(tampered11, '11-TAMPERED-tool-name-changed');
const t11 = verifySignedReceipt(tampered11, exportableSigner);
console.log(`⚠️  11 TAMPERED tool_name changed: verify=${t11.ok}, reason=${t11.reason}`);

// ── Save public key for browser verification ─────────────────────
const keyManifest = {
  description: 'Public key used to sign all receipts in this demo folder. Import into Web Crypto as SPKI/Ed25519 for browser-side verification.',
  public_key_id: exportableSigner.publicKeyId,
  public_key_spki_base64: exportableSigner.publicKeyDerBase64,
  algorithm: 'Ed25519',
  format: 'spki',
};
save(keyManifest, '_public_key');

console.log(`\n✅ Tamper demo complete.`);
console.log(`   Output: ${OUT_DIR}`);
console.log(`   Valid receipts: 5 (01–04, 08)`);
console.log(`   Tampered receipts: 5 (05–07, 09–11)`);
console.log(`   Public key: _public_key.json (for browser verification)`);
console.log(`\n   Load all JSON files in the visualizer to see tamper detection in action.`);
