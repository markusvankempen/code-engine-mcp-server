// Redaction helper.
// Dependency-free.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Policy (v0.1):
// - Never keep raw secret values in material that will be hashed/persisted.
// - Known-sensitive keys are replaced with the marker "<redacted>".
// - Raw file contents are not stored by default; a short redacted preview may
//   be kept, while the full content is represented only by its hash elsewhere.

/**
 * Default set of key names treated as sensitive (case-insensitive match).
 * Extend at the call site as needed.
 */
export const DEFAULT_SENSITIVE_KEYS = new Set([
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'passphrase',
  'secret',
  'private_key',
  'privatekey',
  'client_secret',
  'raw_content',
  'sensitive_context',
]);

export const REDACTED = '<redacted>';

/**
 * Recursively redact sensitive keys from an arbitrary value.
 * Does not mutate the input.
 * @param {unknown} value
 * @param {Set<string>} [sensitiveKeys]
 * @returns {unknown}
 */
export function redact(value, sensitiveKeys = DEFAULT_SENSITIVE_KEYS) {
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, sensitiveKeys));
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = redact(v, sensitiveKeys);
      }
    }
    return out;
  }
  return value;
}
