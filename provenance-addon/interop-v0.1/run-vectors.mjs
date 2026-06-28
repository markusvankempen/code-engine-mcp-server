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
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { join } from 'node:path';
import { verifyFromPublicKey } from '../receipt.mjs';
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

/** BA Interop v0.1 public_key_id: SHA-256 of SPKI DER bytes, full 64 hex chars */
function baPublicKeyId(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

function ourPublicKeyId(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

const REQUIRED_CLAIM_FIELDS = [
  'receipt_version',
  'receipt_role',
  'event_id',
  'timestamp',
  'action_type',
  'status',
];

/** Reference BA interop verifier (mirrors verify-vectors.ts) */
function verifyBaInterop(receiptText, publicKeyPem) {
  let parsed;
  try {
    parsed = JSON.parse(receiptText);
  } catch {
    return 'invalid_json';
  }
  if (!parsed?.claim || typeof parsed.signature !== 'string' || typeof parsed.public_key_id !== 'string') {
    return 'invalid_receipt';
  }
  for (const field of REQUIRED_CLAIM_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsed.claim, field)) {
      return `missing_claim_field:${field}`;
    }
  }
  if (parsed.claim.receipt_version !== '0.1') return 'unsupported_version';
  if (parsed.public_key_id !== baPublicKeyId(publicKeyPem)) return 'public_key_id_mismatch';
  const valid = edVerify(
    null,
    Buffer.from(stableJson(parsed.claim), 'utf8'),
    publicKeyPem,
    Buffer.from(parsed.signature, 'base64'),
  );
  return valid ? 'pass' : 'invalid_signature';
}

function verifyOurs(receiptText, publicKeyPem) {
  const receipt = JSON.parse(receiptText);
  const result = verifyFromPublicKey(receipt, publicKeyPem);
  return result.ok ? 'pass' : result.reason;
}

const CASES = [
  { name: 'valid receipt + public key', receipt: 'valid-receipt.json', key: 'public-key.pem', expected: 'pass' },
  { name: 'tampered claim', receipt: 'tampered-claim.json', key: 'public-key.pem', expected: 'invalid_signature' },
  { name: 'wrong public key', receipt: 'valid-receipt.json', key: 'wrong-public-key.pem', expected: 'public_key_id_mismatch' },
  { name: 'unsupported version', receipt: 'unsupported-version.json', key: 'public-key.pem', expected: 'unsupported_version' },
  { name: 'missing required field', receipt: 'missing-required-field.json', key: 'public-key.pem', expected: 'missing_claim_field:status' },
];

function main() {
  const pubPem = readFileSync(join(VECTOR_DIR, 'public-key.pem'), 'utf8');
  const validReceipt = JSON.parse(readFileSync(join(VECTOR_DIR, 'valid-receipt.json'), 'utf8'));

  console.log('BoundaryAttest Interop Profile v0.1 — vector comparison\n');
  console.log('Key fingerprint (public-key.pem):');
  console.log(`  BA v0.1 : ${baPublicKeyId(pubPem)}`);
  console.log(`  Ours    : ${ourPublicKeyId(pubPem)}`);
  console.log(`  Receipt : ${validReceipt.public_key_id}\n`);

  const baCanon = stableJson(validReceipt.claim);
  const ourCanon = canonicalJson(validReceipt.claim);
  console.log(`Canonicalization match (valid claim): ${baCanon === ourCanon}\n`);

  let allBaOk = true;
  let allOursOk = true;

  for (const c of CASES) {
    const receiptText = readFileSync(join(VECTOR_DIR, c.receipt), 'utf8');
    const keyPem = readFileSync(join(VECTOR_DIR, c.key), 'utf8');
    const ba = verifyBaInterop(receiptText, keyPem);
    const ours = verifyOurs(receiptText, keyPem);
    const baMatch = ba === c.expected;
    // Allow equivalent wording: 'invalid_signature' ≈ 'signature does not verify'
    const oursMatch = ours === c.expected 
      || (c.expected === 'public_key_id_mismatch' && ours.includes('public_key_id'))
      || (c.expected === 'invalid_signature' && ours.includes('signature'));
    allBaOk &&= baMatch;
    allOursOk &&= oursMatch;
    console.log(`${baMatch ? 'PASS' : 'FAIL'} [BA] ${c.name}: expected ${c.expected}, got ${ba}`);
    console.log(`${oursMatch ? 'PASS' : 'FAIL'} [ours] ${c.name}: expected ${c.expected}, got ${ours}`);
    console.log('');
  }

  if (!allBaOk || !allOursOk) {
    process.exitCode = 1;
    console.log('INTEROP: FAIL — one or more vectors did not match expected result.');
  } else {
    console.log('INTEROP: PASS — all vectors match expected results for both verifiers.');
  }
}

main();
