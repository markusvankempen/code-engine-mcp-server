#!/usr/bin/env node
// Run BoundaryAttest Interop Profile v0.1 test vectors against our verifier.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Vectors sourced from:
// https://github.com/cullenmeyers/BoundaryAttest/tree/main/examples/interop-v0.1/test-vectors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyInteropReceiptText, interopPublicKeyId } from '../receipt.mjs';
import { canonicalJson } from '../canonical.mjs';

const VECTOR_DIR = join(import.meta.dirname, 'test-vectors');

/** BoundaryAttest stableJson (interop-profile-v0.1.md) */
function stableJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

const CASES = [
  { name: 'valid receipt + public key', receipt: 'valid-receipt.json', key: 'public-key.pem', expected: 'pass' },
  { name: 'tampered claim', receipt: 'tampered-claim.json', key: 'public-key.pem', expected: 'invalid_signature' },
  { name: 'wrong public key', receipt: 'valid-receipt.json', key: 'wrong-public-key.pem', expected: 'public_key_id_mismatch' },
  { name: 'unsupported version', receipt: 'unsupported-version.json', key: 'public-key.pem', expected: 'unsupported_version' },
  { name: 'unsupported receipt role', receipt: 'unsupported-receipt-role.json', key: 'public-key.pem', expected: 'unsupported_receipt_role' },
  { name: 'missing required field', receipt: 'missing-required-field.json', key: 'public-key.pem', expected: 'missing_claim_field:status' },
];

function main() {
  const pubPem = readFileSync(join(VECTOR_DIR, 'public-key.pem'), 'utf8');
  const validReceipt = JSON.parse(readFileSync(join(VECTOR_DIR, 'valid-receipt.json'), 'utf8'));

  console.log('BoundaryAttest Interop Profile v0.1 — vector run\n');
  console.log(`Public key ID: ${interopPublicKeyId(pubPem)}`);
  console.log(`Receipt key ID: ${validReceipt.public_key_id}`);
  console.log(`Canonicalization match: ${stableJson(validReceipt.claim) === canonicalJson(validReceipt.claim)}\n`);

  let allOk = true;
  for (const c of CASES) {
    const receiptText = readFileSync(join(VECTOR_DIR, c.receipt), 'utf8');
    const keyPem = readFileSync(join(VECTOR_DIR, c.key), 'utf8');
    const result = verifyInteropReceiptText(receiptText, keyPem);
    const actual = result.ok ? 'pass' : result.reason;
    const ok = actual === c.expected;
    allOk &&= ok;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: expected ${c.expected}, got ${actual}`);
  }

  if (!allOk) {
    process.exitCode = 1;
    console.log('\nINTEROP: FAIL');
  } else {
    console.log(`\nINTEROP: PASS — ${CASES.length}/${CASES.length} vectors`);
  }
}

main();
