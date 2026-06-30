#!/usr/bin/env node
// Standalone receipt verifier CLI.
// Verifies one or more receipt JSON files against a public key PEM.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Usage:
//   node verify-receipt.mjs --key <public.pem> <receipt.json> [receipt2.json ...]
//   node verify-receipt.mjs --key-dir <.keys/> <receipt.json>
//
// Exit codes:
//   0 — all receipts verified
//   1 — one or more receipts failed verification
//   2 — usage error

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyInteropReceiptText } from './receipt.mjs';

function usage() {
  console.error(`Usage:
  node verify-receipt.mjs --key <public.pem> <receipt.json> [...]
  node verify-receipt.mjs --key-dir <keys-dir/> <receipt.json> [...]

Options:
  --key <path>       Path to a public key PEM file (SPKI Ed25519)
  --key-dir <path>   Path to key directory containing public.pem

Examples:
  node verify-receipt.mjs --key .keys/public.pem receipts/tamper-demo/01-valid-validate-dockerfile.json
  node verify-receipt.mjs --key-dir .keys receipts/multi-session-demo/*.json
`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 3) usage();

let keyPath = null;
const receiptPaths = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key' && args[i + 1]) {
    keyPath = resolve(args[++i]);
  } else if (args[i] === '--key-dir' && args[i + 1]) {
    keyPath = resolve(join(args[++i], 'public.pem'));
  } else if (args[i].startsWith('--')) {
    console.error(`Unknown option: ${args[i]}`);
    usage();
  } else {
    receiptPaths.push(resolve(args[i]));
  }
}

if (!keyPath || !existsSync(keyPath)) {
  console.error(`Error: public key not found at ${keyPath}`);
  process.exit(2);
}

if (receiptPaths.length === 0) {
  console.error('Error: no receipt files specified.');
  usage();
}

const pem = readFileSync(keyPath, 'utf8');
let passed = 0;
let failed = 0;
let errors = 0;

console.log(`Verifying ${receiptPaths.length} receipt(s) with key: ${keyPath}\n`);

for (const rPath of receiptPaths) {
  const filename = rPath.split('/').pop();
  if (!existsSync(rPath)) {
    console.log(`  ⚠️  ${filename} — file not found`);
    errors++;
    continue;
  }
  try {
    const receiptText = readFileSync(rPath, 'utf8');
    const result = verifyInteropReceiptText(receiptText, pem);
    if (result.ok) {
      console.log(`  ✅ ${filename} — verified`);
      passed++;
    } else {
      console.log(`  ❌ ${filename} — FAILED: ${result.reason}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ⚠️  ${filename} — error: ${err.message}`);
    errors++;
  }
}

console.log(`\nResults: ${passed} verified, ${failed} failed, ${errors} errors (${receiptPaths.length} total)`);

if (failed > 0) {
  console.log('\n⚠️  One or more receipts failed signature verification.');
  console.log('   This indicates the receipt was altered after signing (tampered),');
  console.log('   or it was signed with a different key than the one provided.');
  process.exit(1);
}
if (errors > 0) {
  console.log('\n⚠️  Some files could not be verified (missing or invalid format).');
  process.exit(1);
}
console.log('\n✅ All receipts verified — integrity confirmed.');
