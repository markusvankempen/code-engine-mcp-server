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
 * When the sink fails, the returned object includes a `sinkError` field with
 * full diagnostic context (timestamp, stack trace, event metadata) so callers
 * can log, persist, or forward the failure trace for debugging.
 * @param {ProvenanceSink} sink
 * @param {McpReceiptEvent} event
 * @param {(msg: string, err: unknown, context: SinkErrorContext) => void} [logError]
 * @returns {Promise<{ receiptId: string | null, receiptPath: string | null, receipt?: object, sinkError?: SinkErrorContext }>}
 */
export async function emitToolCompleted(sink, event, logError = defaultLogError) {
  try {
    return await sink.onToolCompleted(event);
  } catch (err) {
    const context = buildErrorContext(sink, event, err);
    logError(`provenance sink "${sink.name}" failed (fail-open)`, err, context);
    return { receiptId: null, receiptPath: null, sinkError: context };
  }
}

/**
 * @typedef {Object} SinkErrorContext
 * @property {string} timestamp       When the sink failure occurred.
 * @property {string} sinkName        Which sink failed.
 * @property {string} eventId         event_id of the receipt event that triggered it.
 * @property {string} toolName        MCP tool that completed before the sink ran.
 * @property {string} targetRef       target_ref from the event.
 * @property {string} traceRef        trace_ref if available (for correlating with MCP logs).
 * @property {string} errorName       Error constructor name.
 * @property {string} errorMessage    Error message.
 * @property {string | null} errorStack  Full stack trace for debugging.
 * @property {string} phase           Which phase of sink processing likely failed.
 */

/**
 * Assemble full diagnostic context for a sink failure.
 * @param {ProvenanceSink} sink
 * @param {McpReceiptEvent} event
 * @param {unknown} err
 * @returns {SinkErrorContext}
 */
function buildErrorContext(sink, event, err) {
  const isError = err instanceof Error;
  const stack = isError ? err.stack : null;
  const message = isError ? err.message : String(err);

  // Heuristic: infer which phase failed from the error message.
  let phase = 'unknown';
  if (message.includes('EACCES') || message.includes('ENOENT') || message.includes('EROFS')) {
    phase = 'file_write';
  } else if (message.includes('ed25519') || message.includes('sign') || message.includes('key')) {
    phase = 'signing';
  } else if (message.includes('circular') || message.includes('JSON') || message.includes('stringify')) {
    phase = 'canonicalization';
  } else if (message.includes('mkdir') || message.includes('ENOSPC')) {
    phase = 'directory_create';
  } else {
    phase = 'adapter_logic';
  }

  return {
    timestamp: new Date().toISOString(),
    sinkName: sink.name,
    eventId: event.event_id ?? 'unknown',
    toolName: event.tool_name ?? 'unknown',
    targetRef: event.target_ref ?? 'unknown',
    traceRef: event.trace_ref ?? '',
    errorName: isError ? err.name : 'UnknownError',
    errorMessage: message,
    errorStack: stack ?? null,
    phase,
  };
}

/**
 * Default error logger. Emits full trace to stderr for local debugging.
 * In production, replace with a structured logger or telemetry sink.
 * @param {string} msg
 * @param {unknown} _err
 * @param {SinkErrorContext} context
 */
function defaultLogError(msg, _err, context) {
  console.error(`[provenance] ${msg}`);
  console.error(`[provenance]   sink: ${context.sinkName} | phase: ${context.phase}`);
  console.error(`[provenance]   event: ${context.eventId} | tool: ${context.toolName}`);
  console.error(`[provenance]   target: ${context.targetRef} | trace: ${context.traceRef}`);
  console.error(`[provenance]   error: ${context.errorName}: ${context.errorMessage}`);
  if (context.errorStack) {
    console.error(`[provenance]   stack:\n${context.errorStack}`);
  }
}
