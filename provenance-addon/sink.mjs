// Provenance sinks and the best-effort emit boundary.
// Dependency-free.
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Contract:
// - A ProvenanceSink receives a completed-tool event and may persist a receipt,
//   attach a receipt reference, or do nothing.
// - The default sink is a no-op. With no sink configured, behavior is unchanged.
// - emitToolCompleted() is FAIL-OPEN: any sink error is caught and logged; it
//   never propagates into the MCP tool result path.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSignedReceipt } from './receipt.mjs';

/**
 * @typedef {import('./receipt.mjs').McpReceiptEvent} McpReceiptEvent
 * @typedef {import('./receipt.mjs').Signer} Signer
 */

/**
 * @typedef {Object} ProvenanceSink
 * @property {string} name
 * @property {(event: McpReceiptEvent) => Promise<{ receiptId: string | null, receiptPath: string | null }>} onToolCompleted
 */

/**
 * No-op sink. Does nothing. This is the safe default.
 * @type {ProvenanceSink}
 */
export const NoopProvenanceSink = {
  name: 'noop',
  async onToolCompleted(_event) {
    return { receiptId: null, receiptPath: null };
  },
};

/**
 * BoundaryAttest adapter sink.
 * Maps a Code Engine MCP event into a signed receipt and (optionally) writes it
 * to a local directory. This is an adapter over the generic event shape; it does
 * not import any BoundaryAttest-specific runtime and the core MCP does not import
 * this module.
 */
export class BoundaryAttestProvenanceSink {
  /**
   * @param {Object} opts
   * @param {boolean} opts.enabled
   * @param {Signer} opts.signer
   * @param {'client_observed' | 'server_attested'} [opts.receiptRole]
   * @param {string} [opts.outDir]  When set, receipts are written here.
   */
  constructor(opts) {
    this.name = 'boundaryattest-adapter';
    this.enabled = opts.enabled;
    this.signer = opts.signer;
    this.receiptRole = opts.receiptRole ?? 'client_observed';
    this.outDir = opts.outDir;
    /** @type {string | null} */
    this.previousReceiptHash = null;
  }

  /**
   * @param {McpReceiptEvent} event
   * @returns {Promise<{ receiptId: string | null, receiptPath: string | null, receipt?: object }>}
   */
  async onToolCompleted(event) {
    if (!this.enabled) return { receiptId: null, receiptPath: null };

    const receipt = buildSignedReceipt(event, this.signer, {
      receiptRole: this.receiptRole,
      previousReceiptHash: this.previousReceiptHash,
    });

    let receiptPath = null;
    if (this.outDir) {
      mkdirSync(this.outDir, { recursive: true });
      const safeTool = String(event.tool_name).replace(/[^a-z0-9_.-]/gi, '_');
      const fileName = `${event.timestamp.replace(/[:.]/g, '-')}-${safeTool}-${event.event_id}.json`;
      receiptPath = join(this.outDir, fileName);
      writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    }

    return { receiptId: event.event_id, receiptPath, receipt };
  }
}

/**
 * Best-effort emit boundary. Never throws into the caller's path.
 * Returns the sink result, or a null result if the sink failed.
 * @param {ProvenanceSink} sink
 * @param {McpReceiptEvent} event
 * @param {(msg: string, err: unknown) => void} [logError]
 * @returns {Promise<{ receiptId: string | null, receiptPath: string | null, receipt?: object }>}
 */
export async function emitToolCompleted(sink, event, logError = defaultLogError) {
  try {
    return await sink.onToolCompleted(event);
  } catch (err) {
    logError(`provenance sink "${sink.name}" failed (fail-open)`, err);
    return { receiptId: null, receiptPath: null };
  }
}

/**
 * @param {string} msg
 * @param {unknown} err
 */
function defaultLogError(msg, err) {
  const detail = err instanceof Error ? err.message : String(err);
  // Supplemental telemetry only; never affects tool outcome.
  console.error(`[provenance] ${msg}: ${detail}`);
}
