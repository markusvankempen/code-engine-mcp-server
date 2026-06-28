#!/usr/bin/env node
// Verify Code Engine reverse interop fixtures (CE receipts + committed public key).
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyFromPublicKey } from '../receipt.mjs';

const FIXTURE_DIR = join(import.meta.dirname, 'ce-reverse-fixtures');
const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8'));
const pubPem = readFileSync(join(FIXTURE_DIR, 'public.pem'), 'utf8');
const receiptDir = resolve(import.meta.dirname, expected.receipt_dir);

console.log('Code Engine reverse interop fixtures\n');
console.log(`Public key ID: ${expected.public_key_id}\n`);

let allOk = true;
for (const c of expected.cases) {
  const receipt = JSON.parse(readFileSync(join(receiptDir, c.receipt), 'utf8'));
  const result = verifyFromPublicKey(receipt, pubPem);
  const actual = result.ok ? 'pass' : result.reason;
  const ok = actual === c.expected;
  allOk &&= ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.receipt}: expected ${c.expected}, got ${actual}`);
}

if (!allOk) process.exitCode = 1;
else console.log('\nAll reverse interop fixtures verified.');
