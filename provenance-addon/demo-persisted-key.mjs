#!/usr/bin/env node
// Demo: persisted key — sign in one "run", verify in another.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// This script demonstrates the P1 workflow:
//   1. Creates (or reloads) a persisted Ed25519 key pair in .keys/
//   2. Signs several receipts and writes them to receipts/persisted-key-demo/
//   3. Drops the signer object (simulating end of process)
//   4. Reloads the public key and verifies each receipt independently
//
// Run:
//   node demo-persisted-key.mjs
//   # or:  ./run-demo-persisted-key.sh

import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateSigner, buildSignedReceipt, verifyFromPublicKey, newEventId } from './receipt.mjs';

const KEY_DIR = join(import.meta.dirname, '.keys');
const RECEIPT_DIR = join(import.meta.dirname, 'receipts', 'persisted-key-demo');
const REVERSE_FIXTURE_DIR = join(import.meta.dirname, 'interop-v0.1', 'ce-reverse-fixtures');
mkdirSync(RECEIPT_DIR, { recursive: true });
mkdirSync(REVERSE_FIXTURE_DIR, { recursive: true });

// ─── Phase 1: Sign ────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log(' Phase 1: Sign receipts with persisted key');
console.log('═══════════════════════════════════════════════════════════\n');

const signer = loadOrCreateSigner(KEY_DIR);
console.log(`Key directory : ${signer.keyDir}`);
console.log(`Public key ID : ${signer.publicKeyId}`);
console.log(`Public key PEM: ${join(KEY_DIR, 'public.pem')}\n`);

const events = [
  {
    tool_name: 'workspace.write_or_modify_file',
    action_type: 'write_or_modify_file',
    status: 'executed',
    target_ref: 'path:src/main.ts',
    session_id: 'session:deploy-v2-20260626-1400',
    task_id: 'task:scaffold-app',
    input: { path: 'src/main.ts', content: '/* main */' },
    output: { bytes_written: 128 },
  },
  {
    tool_name: 'workspace.write_or_modify_file',
    action_type: 'write_or_modify_file',
    status: 'executed',
    target_ref: 'path:Dockerfile',
    session_id: 'session:deploy-v2-20260626-1400',
    task_id: 'task:scaffold-app',
    artifact_content: 'FROM node:20-alpine\nCOPY . /app\nRUN npm ci\nCMD ["node","src/main.ts"]',
    input: { path: 'Dockerfile' },
    output: { bytes_written: 78 },
  },
  {
    tool_name: 'ibmcloud.code-engine.application.update',
    action_type: 'write_or_modify_file',
    status: 'executed',
    target_ref: 'ce:us-south/my-project/my-app',
    session_id: 'session:deploy-v2-20260626-1400',
    task_id: 'task:deploy-app',
    input: { image: 'us.icr.io/ns/my-app:v2', min_scale: 1 },
    output: { revision: 'my-app-00003-rev', url: 'https://my-app.us-south.codeengine.appdomain.cloud' },
  },
  {
    tool_name: 'ibmcloud.code-engine.application.update',
    action_type: 'write_or_modify_file',
    status: 'failed',
    target_ref: 'ce:us-south/my-project/my-app',
    session_id: 'session:deploy-v2-20260626-1400',
    task_id: 'task:deploy-app',
    input: { env_vars: { DB_URL: '***' } },
    error: { code: 'E_QUOTA', message: 'env var limit exceeded' },
  },
];

const signedReceipts = [];
for (const [i, baseEvent] of events.entries()) {
  const event = {
    event_version: '0.1',
    event_id: newEventId(),
    timestamp: new Date(Date.now() + i * 15000).toISOString(),
    trace_ref: baseEvent.session_id,
    git_ref: 'sha:abc123def',
    lineage_ref: 'lineage:deploy-v2',
    ...baseEvent,
  };
  const receipt = buildSignedReceipt(event, signer);
  const filename = `${String(i + 1).padStart(2, '0')}-${baseEvent.tool_name.split('.').pop()}-${baseEvent.status}.json`;
  const outPath = join(RECEIPT_DIR, filename);
  writeFileSync(outPath, JSON.stringify(receipt, null, 2));
  signedReceipts.push(filename);
  console.log(`  Signed: ${filename}`);
}
console.log(`\n  → ${signedReceipts.length} receipts written to ${RECEIPT_DIR}\n`);

// Publish public key for reverse interop (private key stays in gitignored .keys/)
writeFileSync(join(REVERSE_FIXTURE_DIR, 'public.pem'), readFileSync(join(KEY_DIR, 'public.pem')));
console.log(`  → public key copied to ${REVERSE_FIXTURE_DIR}/public.pem (reverse interop)\n`);

// ─── Phase 2: Verify (simulated separate process) ────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log(' Phase 2: Verify receipts using only public key');
console.log('═══════════════════════════════════════════════════════════\n');

const pubPemPath = join(KEY_DIR, 'public.pem');
console.log(`Verifying with: ${pubPemPath}\n`);

const files = readdirSync(RECEIPT_DIR).filter(f => f.endsWith('.json')).sort();
let passed = 0, failed = 0;
for (const file of files) {
  const receipt = JSON.parse(readFileSync(join(RECEIPT_DIR, file), 'utf8'));
  const result = verifyFromPublicKey(receipt, pubPemPath);
  if (result.ok) {
    console.log(`  ✅ ${file}`);
    passed++;
  } else {
    console.log(`  ❌ ${file} — ${result.reason}`);
    failed++;
  }
}

console.log(`\n  Results: ${passed} verified, ${failed} failed\n`);

// ─── Phase 3: Tamper one receipt and re-verify ────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log(' Phase 3: Demonstrate tamper detection');
console.log('═══════════════════════════════════════════════════════════\n');

const firstFile = files[0];
const original = JSON.parse(readFileSync(join(RECEIPT_DIR, firstFile), 'utf8'));
const tampered = JSON.parse(JSON.stringify(original));
tampered.claim.target_ref = 'path:EVIL_INJECTED.ts';

console.log(`  Original target_ref : ${original.claim.target_ref}`);
console.log(`  Tampered target_ref : ${tampered.claim.target_ref}\n`);

const tampResult = verifyFromPublicKey(tampered, pubPemPath);
console.log(`  Verification result : ${tampResult.ok ? '✅ OK' : '❌ FAILED — ' + tampResult.reason}`);

console.log('\n═══════════════════════════════════════════════════════════');
console.log(' Summary');
console.log('═══════════════════════════════════════════════════════════');
console.log(`
  Key pair persisted in: ${KEY_DIR}
  Receipts stored in   : ${RECEIPT_DIR}
  
  To verify externally (e.g. different machine, CI pipeline):
    node verify-receipt.mjs --key ${join(KEY_DIR, 'public.pem')} ${join(RECEIPT_DIR, '*.json')}
`);
