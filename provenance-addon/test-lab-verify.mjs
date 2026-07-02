#!/usr/bin/env node
// Smoke-check test-manifest.json cases against Node verifiers (mirrors test-lab.html).
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { verifyInteropReceiptText, verifyFromPublicKey } from './receipt.mjs';
import { verifyArtifactHash } from './artifact.mjs';
import { canonicalJson } from './canonical.mjs';

const ROOT = import.meta.dirname;
const manifest = JSON.parse(readFileSync(join(ROOT, 'test-manifest.json'), 'utf8'));

function verifyWithSpkiJson(receipt, keyJson) {
  const pub = createPublicKey({
    key: Buffer.from(keyJson.public_key_spki_base64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (receipt.public_key_id !== keyJson.public_key_id) {
    return { ok: false, reason: 'public_key_id_mismatch' };
  }
  const ok = edVerify(
    null,
    Buffer.from(canonicalJson(receipt.claim), 'utf8'),
    pub,
    Buffer.from(receipt.signature, 'base64'),
  );
  return ok ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}

let fail = 0;
let pass = 0;

for (const suite of manifest.suites) {
  console.log(`\n${suite.title}`);
  for (const c of suite.cases) {
    let result;
    if (suite.id === 'ba-interop') {
      const dir = join(ROOT, suite.fixtureDir);
      result = verifyInteropReceiptText(
        readFileSync(join(dir, c.receipt), 'utf8'),
        readFileSync(join(dir, c.key), 'utf8'),
      );
    } else if (suite.id === 'ce-reverse') {
      const receipt = JSON.parse(readFileSync(join(ROOT, suite.receiptDir, c.receipt), 'utf8'));
      result = verifyFromPublicKey(receipt, join(ROOT, suite.fixtureDir, 'public.pem'));
    } else if (suite.id === 'artifact-demo') {
      const dir = join(ROOT, suite.fixtureDir);
      const receipt = JSON.parse(readFileSync(join(dir, c.receipt), 'utf8'));
      if (c.artifactOnly) {
        result = verifyArtifactHash(receipt, join(dir, c.artifact));
      } else {
        const sig = verifyFromPublicKey(receipt, join(dir, c.key));
        if (!sig.ok) result = sig;
        else result = verifyArtifactHash(receipt, join(dir, c.artifact));
      }
    } else if (suite.id === 'tamper-demo') {
      const dir = join(ROOT, suite.fixtureDir);
      const receipt = JSON.parse(readFileSync(join(dir, c.receipt), 'utf8'));
      const keyJson = JSON.parse(readFileSync(join(dir, suite.keyFile), 'utf8'));
      result = verifyWithSpkiJson(receipt, keyJson);
    }
    const actual = result.ok ? 'pass' : result.reason;
    const ok = actual === c.expected;
    pass += ok ? 1 : 0;
    fail += ok ? 0 : 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: expected ${c.expected}, got ${actual}`);
  }
}

console.log(`\nTest lab manifest: ${pass}/${pass + fail} cases OK`);
if (fail) process.exitCode = 1;
