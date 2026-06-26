// Receipt building, signing, and verification.
// Dependency-free: uses Node's built-in ed25519 (node:crypto).
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// The CANONICAL SIGNED PAYLOAD is exactly the `claim` object, serialized with
// canonicalJson(). The signature covers that and nothing else. Verifiers must
// recompute canonicalJson(receipt.claim) and check it against the signature.

import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { canonicalJson, hashCanonical, hashRaw } from './canonical.mjs';
import { redact } from './redact.mjs';

/**
 * @typedef {'write_or_modify_file' | 'generate_patch_or_scaffold'} ReceiptActionType
 * @typedef {'executed' | 'failed'} ReceiptStatus
 * @typedef {'client_observed' | 'server_attested'} ReceiptRole
 */

/**
 * @typedef {Object} McpReceiptEvent
 * @property {'0.1'} event_version
 * @property {string} event_id
 * @property {string} timestamp
 * @property {string} tool_name
 * @property {ReceiptActionType} action_type
 * @property {ReceiptStatus} status
 * @property {string} target_ref
 * @property {string} [trace_ref]
 * @property {string} [git_ref]
 * @property {string} [lineage_ref]
 * @property {unknown} [input]
 * @property {unknown} [output]
 * @property {unknown} [error]
 * @property {string | Buffer} [artifact_content]
 *   Raw bytes of the produced file, patch, or scaffold artifact.
 *   Hashed with hashRaw() BEFORE any redaction; the raw value is never
 *   placed in the signed claim. Only the resulting `artifact_hash` appears.
 *   Use this field to bind the receipt to the exact artifact content.
 */

/**
 * @typedef {Object} Signer
 * @property {(data: string) => string} sign  Returns base64 signature over UTF-8 data.
 * @property {string} publicKeyId             `sha256:<hex>` of the public key DER.
 * @property {(data: string, signatureB64: string) => boolean} verify
 */

/**
 * Create a local ed25519 signer. For dev/PoC only — not production key custody.
 *
 * WARNING: generates a NEW ephemeral key pair on every call. Receipts signed in
 * one process run CANNOT be verified in a different process run because the
 * private key is gone when the process exits. For receipts to be verifiable
 * across runs, use a persisted key file or a KMS/HSM-backed signer instead.
 * @returns {Signer}
 */
export function createLocalSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyId = hashRaw(pubDer);

  return {
    publicKeyId,
    sign(data) {
      return edSign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64');
    },
    verify(data, signatureB64) {
      return edVerify(
        null,
        Buffer.from(data, 'utf8'),
        publicKey,
        Buffer.from(signatureB64, 'base64'),
      );
    },
  };
}

/**
 * Build a redacted + hashed + signed receipt from a raw event.
 * Raw file contents / secrets are never placed in the claim — only hashes.
 * @param {McpReceiptEvent} event
 * @param {Signer} signer
 * @param {Object} [opts]
 * @param {ReceiptRole} [opts.receiptRole] default 'client_observed'
 * @param {string | null} [opts.previousReceiptHash]
 * @returns {{ claim: Record<string, unknown>, signature: string, public_key_id: string }}
 */
export function buildSignedReceipt(event, signer, opts = {}) {
  const receiptRole = opts.receiptRole ?? 'client_observed';
  // previous_receipt_hash is reserved for future receipt chaining.
  // Always null in v0.1 unless the sink explicitly maintains the chain.
  const previousReceiptHash = opts.previousReceiptHash ?? null;

  // artifact_hash: hash the raw artifact content BEFORE redaction so the receipt
  // binds to the exact file, patch, or scaffold produced. Raw bytes never enter
  // the claim — only the digest appears. Absent when no artifact_content supplied.
  const artifactHash =
    event.artifact_content !== undefined ? hashRaw(event.artifact_content) : undefined;

  const redactedInput = event.input === undefined ? undefined : redact(event.input);
  const redactedOutput = event.output === undefined ? undefined : redact(event.output);
  const redactedError = event.error === undefined ? undefined : redact(event.error);

  const inputHash = redactedInput === undefined ? undefined : hashCanonical(redactedInput);
  const outputHash =
    event.status === 'executed' && redactedOutput !== undefined
      ? hashCanonical(redactedOutput)
      : null;
  // error_hash is always present as null on success; output_hash is always
  // present as null on failure. This is intentional for deterministic canonical
  // payload shape — verifiers should expect both fields in every claim.
  const errorHash =
    event.status === 'failed' && redactedError !== undefined
      ? hashCanonical(redactedError)
      : null;

  // The claim is the canonical signed payload. Optional refs are included only
  // when present; they are references, never required dependencies.
  /** @type {Record<string, unknown>} */
  const claim = {
    receipt_version: '0.1',
    receipt_role: receiptRole,
    event_id: event.event_id,
    timestamp: event.timestamp,
    tool_name: event.tool_name,
    action_type: event.action_type,
    status: event.status,
    target_ref: event.target_ref,
  };
  if (artifactHash !== undefined) claim.artifact_hash = artifactHash;
  if (inputHash !== undefined) claim.input_hash = inputHash;
  claim.output_hash = outputHash;
  claim.error_hash = errorHash;
  if (event.trace_ref !== undefined) claim.trace_ref = event.trace_ref;
  if (event.git_ref !== undefined) claim.git_ref = event.git_ref;
  if (event.lineage_ref !== undefined) claim.lineage_ref = event.lineage_ref;
  // Reserved for future receipt chaining. Null in v0.1 unless chain is active.
  claim.previous_receipt_hash = previousReceiptHash;

  const signature = signer.sign(canonicalJson(claim));

  return { claim, signature, public_key_id: signer.publicKeyId };
}

/**
 * Verify a signed receipt against a signer's public key.
 * Checks: signature validity over the canonical claim.
 * @param {{ claim: Record<string, unknown>, signature: string, public_key_id: string }} receipt
 * @param {Signer} signer
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifySignedReceipt(receipt, signer) {
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, reason: 'receipt is not an object' };
  }
  if (receipt.public_key_id !== signer.publicKeyId) {
    return { ok: false, reason: 'public_key_id does not match expected signer' };
  }
  const ok = signer.verify(canonicalJson(receipt.claim), receipt.signature);
  return ok ? { ok: true } : { ok: false, reason: 'signature does not verify' };
}

/** Generate a fresh event id (UUID v4). */
export function newEventId() {
  return randomUUID();
}
