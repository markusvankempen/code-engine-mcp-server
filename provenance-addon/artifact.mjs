// Artifact hash verification — bind receipts to file/patch bytes on disk.
// Dependency-free: uses canonical.mjs hashRaw only.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Policy-layer check (not mandatory interop crypto verification):
// confirms hashRaw(artifact bytes) === claim.artifact_hash

import { readFileSync, existsSync } from 'node:fs';
import { hashRaw } from './canonical.mjs';

/** @param {string} reason @returns {{ ok: false, reason: string }} */
function fail(reason) {
  return { ok: false, reason };
}

/**
 * @param {unknown} receipt
 * @returns {Record<string, unknown> | null}
 */
function claimFrom(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const r = /** @type {{ claim?: unknown }} */ (receipt);
  if (r.claim && typeof r.claim === 'object' && !Array.isArray(r.claim)) {
    return /** @type {Record<string, unknown>} */ (r.claim);
  }
  return /** @type {Record<string, unknown>} */ (receipt);
}

/**
 * Verify artifact bytes against claim.artifact_hash.
 *
 * Failure codes:
 * - invalid_receipt
 * - artifact_hash_missing
 * - artifact_hash_mismatch
 *
 * @param {unknown} receipt  Full receipt or claim object.
 * @param {string | Buffer} artifactBytesOrPath  Raw bytes or path to a file.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyArtifactHash(receipt, artifactBytesOrPath) {
  const claim = claimFrom(receipt);
  if (!claim) return fail('invalid_receipt');

  const expected = claim.artifact_hash;
  if (typeof expected !== 'string' || !expected.startsWith('sha256:')) {
    return fail('artifact_hash_missing');
  }

  let bytes;
  if (Buffer.isBuffer(artifactBytesOrPath)) {
    bytes = artifactBytesOrPath;
  } else if (typeof artifactBytesOrPath === 'string') {
    if (!existsSync(artifactBytesOrPath)) {
      return fail('artifact_file_not_found');
    }
    bytes = readFileSync(artifactBytesOrPath);
  } else {
    return fail('invalid_artifact_input');
  }

  const actual = hashRaw(bytes);
  return actual === expected ? { ok: true } : fail('artifact_hash_mismatch');
}

/**
 * Verify receipt signature + artifact hash (when key and file provided).
 *
 * @param {unknown} receipt
 * @param {string} publicKeyPemOrPath
 * @param {string | Buffer} artifactBytesOrPath
 * @param {(receipt: unknown, pem: string) => { ok: boolean, reason?: string }} verifyReceipt
 * @returns {{ ok: true } | { ok: false, reason: string, phase?: 'receipt' | 'artifact' }}
 */
export function verifyReceiptAndArtifact(receipt, publicKeyPemOrPath, artifactBytesOrPath, verifyReceipt) {
  const sig = verifyReceipt(receipt, publicKeyPemOrPath);
  if (!sig.ok) {
    return { ok: false, reason: sig.reason ?? 'invalid_signature', phase: 'receipt' };
  }
  const art = verifyArtifactHash(receipt, artifactBytesOrPath);
  if (!art.ok) {
    return { ok: false, reason: art.reason, phase: 'artifact' };
  }
  return { ok: true };
}
