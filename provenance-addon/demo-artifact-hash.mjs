#!/usr/bin/env node
// Demo: P2 artifact hash verification — receipt + file binding.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// 1. Signs a receipt with artifact_hash for a Dockerfile
// 2. Writes the artifact file to receipts/artifact-demo/
// 3. Verifies signature + hash match, then detects tampered file bytes

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateSigner, buildSignedReceipt, verifyInteropReceipt, newEventId } from './receipt.mjs';
import { verifyArtifactHash, verifyReceiptAndArtifact } from './artifact.mjs';
import { hashRaw } from './canonical.mjs';

const OUT_DIR = join(import.meta.dirname, 'receipts', 'artifact-demo');
const KEY_DIR = join(OUT_DIR, '.keys');
mkdirSync(OUT_DIR, { recursive: true });

const DOCKERFILE = `FROM node:20-alpine
COPY . /app
WORKDIR /app
RUN npm ci --omit=dev
CMD ["node", "src/main.ts"]
`;

console.log('═══════════════════════════════════════════════════════════');
console.log(' P2: Artifact hash verification demo');
console.log('═══════════════════════════════════════════════════════════\n');

const signer = loadOrCreateSigner(KEY_DIR);
writeFileSync(join(OUT_DIR, 'public.pem'), signer.publicKeyPem);

const event = {
  event_version: '0.1',
  event_id: newEventId(),
  timestamp: new Date().toISOString(),
  tool_name: 'workspace.write_or_modify_file',
  action_type: 'write_or_modify_file',
  status: 'executed',
  target_ref: 'path:Dockerfile',
  session_id: 'session:artifact-demo-20260630',
  task_id: 'task:write-dockerfile',
  trace_ref: 'session:artifact-demo-20260630',
  artifact_content: DOCKERFILE,
  input: { path: 'Dockerfile' },
  output: { bytes_written: DOCKERFILE.length },
};

const receipt = buildSignedReceipt(event, signer);
const artifactPath = join(OUT_DIR, 'Dockerfile');
const receiptPath = join(OUT_DIR, 'write-dockerfile.json');

writeFileSync(artifactPath, DOCKERFILE);
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

console.log(`artifact_hash in claim: ${receipt.claim.artifact_hash}`);
console.log(`hashRaw(file on disk):  ${hashRaw(DOCKERFILE)}`);
console.log(`Receipt written:  ${receiptPath}`);
console.log(`Artifact written: ${artifactPath}\n`);

// Phase 1: signature + artifact
const full = verifyReceiptAndArtifact(
  receipt,
  signer.publicKeyPem,
  artifactPath,
  (r, pem) => verifyInteropReceipt(r, pem),
);
console.log(`Phase 1 — signature + artifact: ${full.ok ? '✅ PASS' : '❌ ' + full.reason}`);

// Phase 2: artifact only (external auditor with receipt + file, no key)
const artOnly = verifyArtifactHash(receipt, artifactPath);
console.log(`Phase 2 — artifact only:        ${artOnly.ok ? '✅ PASS' : '❌ ' + artOnly.reason}`);

// Phase 3: tampered file
const tamperedPath = join(OUT_DIR, 'Dockerfile.tampered');
writeFileSync(tamperedPath, DOCKERFILE + '# evil injection\n');
const tampered = verifyArtifactHash(receipt, tamperedPath);
console.log(`Phase 3 — tampered file:        ${tampered.ok ? '✅ PASS' : '❌ ' + tampered.reason} (expected fail)`);

// Phase 4: missing artifact_hash
const noHash = JSON.parse(JSON.stringify(receipt));
delete noHash.claim.artifact_hash;
const missing = verifyArtifactHash(noHash, artifactPath);
console.log(`Phase 4 — no artifact_hash:     ${missing.ok ? '✅ PASS' : '❌ ' + missing.reason} (expected fail)`);

console.log(`
Verify externally:
  node verify-artifact.mjs --receipt ${receiptPath} --file ${artifactPath}
  node verify-artifact.mjs --receipt ${receiptPath} --file ${artifactPath} --key ${join(OUT_DIR, 'public.pem')}
`);
