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

import { generateKeyPairSync, createPublicKey, createPrivateKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * @property {string} [session_id]
 *   Chat thread / conversation ID. All tool calls within one AI chat session
 *   share the same session_id. Maps to: "which conversation is this from?"
 * @property {string} [task_id]
 *   Sub-task within a session. When a user asks one question and the AI makes
 *   multiple tool calls to answer it, all those calls share the same task_id.
 *   A new user prompt or a new AI goal starts a new task_id.
 *   Maps to: "which part of the conversation caused this call?"
 * @property {string} [trace_ref]
 *   MCP-level trace/correlation ID for operational log linkage.
 *   In practice often equals session_id, but may be a lower-level RPC trace.
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
 * Create or load a persisted Ed25519 signer from a key directory.
 *
 * If the directory contains `private.pem` and `public.pem`, they are loaded.
 * Otherwise a new key pair is generated and saved. This enables receipts to be
 * verified across process runs — the same key is reused on subsequent calls.
 *
 * Key files:
 *   <keyDir>/private.pem  — PKCS8 PEM (keep secret, 0600)
 *   <keyDir>/public.pem   — SPKI PEM (safe to distribute to verifiers)
 *
 * @param {string} keyDir  Directory for key files (created if absent).
 * @returns {Signer & { publicKeyPem: string, keyDir: string }}
 */
export function loadOrCreateSigner(keyDir) {
  mkdirSync(keyDir, { recursive: true });
  const privPath = join(keyDir, 'private.pem');
  const pubPath = join(keyDir, 'public.pem');

  let publicKey, privateKey;

  if (existsSync(privPath) && existsSync(pubPath)) {
    const privPem = readFileSync(privPath, 'utf8');
    const pubPem = readFileSync(pubPath, 'utf8');
    privateKey = createPrivateKey(privPem);
    publicKey = createPublicKey(pubPem);
  } else {
    ({ publicKey, privateKey } = generateKeyPairSync('ed25519'));
    writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  }

  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyId = hashRaw(pubDer);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  return {
    publicKeyId,
    publicKeyPem,
    keyDir,
    sign(data) {
      return edSign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64');
    },
    verify(data, signatureB64) {
      return edVerify(null, Buffer.from(data, 'utf8'), publicKey, Buffer.from(signatureB64, 'base64'));
    },
  };
}

const INTEROP_REQUIRED_TOP_LEVEL = ['claim', 'signature', 'public_key_id'];
const INTEROP_REQUIRED_CLAIM = [
  'receipt_version',
  'receipt_role',
  'event_id',
  'timestamp',
  'action_type',
  'status',
];

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} obj @param {string} field */
function hasOwn(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field);
}

/** @param {string} reason @returns {{ ok: false, reason: string }} */
function fail(reason) {
  return { ok: false, reason };
}

/**
 * @param {string} publicKeyPemOrPath
 * @returns {string}
 */
function loadPublicKeyPem(publicKeyPemOrPath) {
  if (publicKeyPemOrPath.includes('-----BEGIN')) {
    return publicKeyPemOrPath;
  }
  return readFileSync(publicKeyPemOrPath, 'utf8');
}

/**
 * BoundaryAttest Interop Profile v0.1 public key fingerprint (SPKI DER SHA-256).
 * @param {string} publicKeyPemOrPath
 * @returns {string}
 */
export function interopPublicKeyId(publicKeyPemOrPath) {
  const pem = loadPublicKeyPem(publicKeyPemOrPath);
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return hashRaw(der);
}

/**
 * Structural checks for Interop Profile v0.1 (no signature verification).
 * @param {unknown} receipt
 * @returns {{ ok: false, reason: string } | null}
 */
function verifyInteropStructure(receipt) {
  if (!isRecord(receipt)) {
    return fail('invalid_receipt');
  }
  for (const field of INTEROP_REQUIRED_TOP_LEVEL) {
    if (!hasOwn(receipt, field)) {
      return fail(`missing_top_level_field:${field}`);
    }
  }
  for (const field of Object.keys(receipt)) {
    if (!INTEROP_REQUIRED_TOP_LEVEL.includes(field)) {
      return fail(`unexpected_top_level_field:${field}`);
    }
  }
  if (!isRecord(receipt.claim)) {
    return fail('claim_not_object');
  }
  if (typeof receipt.signature !== 'string' || typeof receipt.public_key_id !== 'string') {
    return fail('invalid_receipt');
  }
  for (const field of INTEROP_REQUIRED_CLAIM) {
    if (!hasOwn(receipt.claim, field)) {
      return fail(`missing_claim_field:${field}`);
    }
  }
  if (receipt.claim.receipt_version !== '0.1') {
    return fail('unsupported_version');
  }
  const role = receipt.claim.receipt_role;
  if (role !== 'client_observed' && role !== 'server_attested') {
    return fail('unsupported_receipt_role');
  }
  return null;
}

/**
 * Verify a receipt against BoundaryAttest Interop Profile v0.1 expectations.
 * Uses normative failure reason codes documented upstream.
 *
 * @param {unknown} receipt
 * @param {string} publicKeyPemOrPath  PEM string, or path to a .pem file.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyInteropReceipt(receipt, publicKeyPemOrPath) {
  const structural = verifyInteropStructure(receipt);
  if (structural) return structural;

  const pem = loadPublicKeyPem(publicKeyPemOrPath);
  if (/** @type {{ public_key_id: string }} */ (receipt).public_key_id !== interopPublicKeyId(pem)) {
    return fail('public_key_id_mismatch');
  }

  try {
    const publicKey = createPublicKey(pem);
    const ok = edVerify(
      null,
      Buffer.from(canonicalJson(/** @type {{ claim: Record<string, unknown> }} */ (receipt).claim), 'utf8'),
      publicKey,
      Buffer.from(/** @type {{ signature: string }} */ (receipt).signature, 'base64'),
    );
    return ok ? { ok: true } : fail('invalid_signature');
  } catch {
    return fail('invalid_signature');
  }
}

/**
 * Parse receipt JSON and verify against Interop Profile v0.1.
 * @param {string} receiptText
 * @param {string} publicKeyPemOrPath
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyInteropReceiptText(receiptText, publicKeyPemOrPath) {
  let parsed;
  try {
    parsed = JSON.parse(receiptText);
  } catch {
    return fail('invalid_json');
  }
  return verifyInteropReceipt(parsed, publicKeyPemOrPath);
}

/**
 * Verify a receipt using only a public key PEM file (no Signer object needed).
 * Alias for {@link verifyInteropReceipt} — external verification path.
 *
 * @param {unknown} receipt
 * @param {string} publicKeyPemOrPath  PEM string, or path to a .pem file.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyFromPublicKey(receipt, publicKeyPemOrPath) {
  return verifyInteropReceipt(receipt, publicKeyPemOrPath);
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
  if (event.session_id !== undefined) claim.session_id = event.session_id;
  if (event.task_id !== undefined) claim.task_id = event.task_id;
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
  const structural = verifyInteropStructure(receipt);
  if (structural) return structural;
  if (receipt.public_key_id !== signer.publicKeyId) {
    return fail('public_key_id_mismatch');
  }
  const ok = signer.verify(canonicalJson(receipt.claim), receipt.signature);
  return ok ? { ok: true } : fail('invalid_signature');
}

/** Generate a fresh event id (UUID v4). */
export function newEventId() {
  return randomUUID();
}
