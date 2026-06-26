// Canonical JSON serialization and SHA-256 hashing.
// Dependency-free: uses only Node built-ins.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Canonicalization rules (must match the documented v0.1 contract):
// - Sort object keys recursively.
// - Remove keys whose value is `undefined`.
// - Preserve array order.
// - Serialize as compact UTF-8 JSON (no extra whitespace).
// - Digest values are prefixed with the algorithm: `sha256:<hex>`.

import { createHash } from 'node:crypto';

/**
 * Recursively produce a canonical, deterministic structure:
 * object keys sorted, `undefined` values dropped, arrays preserved.
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      const v = /** @type {Record<string, unknown>} */ (value)[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Canonical compact JSON string for a value.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * SHA-256 of the canonical JSON of a value, as `sha256:<hex>`.
 * @param {unknown} value
 * @returns {string}
 */
export function hashCanonical(value) {
  const hex = createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * SHA-256 of a raw string or Buffer, as `sha256:<hex>`.
 * @param {string | Buffer} data
 * @returns {string}
 */
export function hashRaw(data) {
  const hex = createHash('sha256').update(data).digest('hex');
  return `sha256:${hex}`;
}
