#!/usr/bin/env node
// CLI: verify claim.artifact_hash against a file on disk.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Usage:
//   node verify-artifact.mjs --receipt <receipt.json> --file <artifact-path>
//   node verify-artifact.mjs --receipt <receipt.json> --file <path> --key <public.pem>
//
// Exit: 0 ok | 1 failed | 2 usage

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyArtifactHash, verifyReceiptAndArtifact } from './artifact.mjs';
import { verifyInteropReceipt } from './receipt.mjs';

function usage() {
  console.error(`Usage:
  node verify-artifact.mjs --receipt <receipt.json> --file <artifact-path>
  node verify-artifact.mjs --receipt <receipt.json> --file <path> --key <public.pem>

Verifies hashRaw(file bytes) === claim.artifact_hash.
With --key, also runs interop receipt signature verification first.
`);
  process.exit(2);
}

const args = process.argv.slice(2);
let receiptPath = null;
let filePath = null;
let keyPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--receipt' && args[i + 1]) receiptPath = resolve(args[++i]);
  else if (args[i] === '--file' && args[i + 1]) filePath = resolve(args[++i]);
  else if (args[i] === '--key' && args[i + 1]) keyPath = resolve(args[++i]);
  else if (args[i].startsWith('--')) usage();
}

if (!receiptPath || !filePath) usage();
if (!existsSync(receiptPath)) {
  console.error(`Receipt not found: ${receiptPath}`);
  process.exit(2);
}
if (!existsSync(filePath)) {
  console.error(`Artifact file not found: ${filePath}`);
  process.exit(2);
}

const receiptText = readFileSync(receiptPath, 'utf8');
const receipt = JSON.parse(receiptText);

console.log(`Receipt: ${receiptPath}`);
console.log(`Artifact: ${filePath}`);
if (receipt?.claim?.artifact_hash) {
  console.log(`Expected artifact_hash: ${receipt.claim.artifact_hash}\n`);
} else {
  console.log('Expected artifact_hash: (missing in claim)\n');
}

let result;
if (keyPath) {
  if (!existsSync(keyPath)) {
    console.error(`Public key not found: ${keyPath}`);
    process.exit(2);
  }
  const pem = readFileSync(keyPath, 'utf8');
  result = verifyReceiptAndArtifact(
    receipt,
    pem,
    filePath,
    (r, p) => verifyInteropReceipt(r, p),
  );
  if (result.ok) {
    console.log('✅ Receipt signature verified');
    console.log('✅ Artifact hash matches file bytes');
    process.exit(0);
  }
  if (result.phase === 'receipt') {
    console.log(`❌ Receipt verification failed: ${result.reason}`);
  } else {
    console.log('✅ Receipt signature verified');
    console.log(`❌ Artifact verification failed: ${result.reason}`);
  }
  process.exit(1);
}

result = verifyArtifactHash(receipt, filePath);
if (result.ok) {
  console.log('✅ Artifact hash matches file bytes');
  process.exit(0);
}
console.log(`❌ Artifact verification failed: ${result.reason}`);
process.exit(1);
