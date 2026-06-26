// End-to-end example: emit a signed receipt AFTER a simulated tool completion.
// Run: node provenance-addon/example.mjs
//
// ## 👤 Autor/Developer
// Markus van Kempen
// Email: markus.van.kempen@gmail.com | mvankempen@ca.ibm.com
// Website: https://markusvankempen.github.io/
// No bug too small, no syntax too weird.
//
// Demonstrates:
// 1. The default no-op sink (addon absent) -> tool behaves normally, no receipt.
// 2. The BoundaryAttest adapter sink -> redact, hash, sign, write, verify.
// 3. Fail-open behavior -> a throwing sink does not break the tool result.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  NoopProvenanceSink,
  BoundaryAttestProvenanceSink,
  emitToolCompleted,
} from './sink.mjs';
import { createLocalSigner, verifySignedReceipt, newEventId } from './receipt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECEIPTS_DIR = join(__dirname, 'receipts');

/** Simulate the MCP tool actually doing its work and returning a result. */
async function runWriteOrModifyFileTool() {
  // Pretend we wrote a file. Raw content stays local and is NOT put in the receipt.
  return {
    rawContent: 'export function start() { return 42; }\n',
    result: { bytes_written: 39, file_sha256: 'sha256:deadbeef', warnings: [] },
  };
}

/**
 * Build the generic post-action event for a completed tool call.
 * @param {object} toolResult
 * @returns {import('./receipt.mjs').McpReceiptEvent}
 */
function buildEvent(toolResult) {
  return {
    event_version: '0.1',
    event_id: newEventId(),
    timestamp: new Date().toISOString(),
    tool_name: 'workspace.write_or_modify_file',
    action_type: 'write_or_modify_file',
    status: 'executed',
    target_ref: 'path:src/index.ts',
    trace_ref: 'trace:rpc-demo-001',
    git_ref: 'main@1a2b3c4',
    lineage_ref: 'ticket:ENG-417',
    input: {
      path: 'src/index.ts',
      operation: 'update',
      // Sensitive fields are redacted before hashing; raw content is not stored.
      raw_content: toolResult.rawContent,
      api_key: 'super-secret-value-should-never-appear',
    },
    output: toolResult.result,
  };
}

async function main() {
  const signer = createLocalSigner();

  // --- 1. Default no-op sink: addon absent, behavior unchanged ---
  {
    const toolResult = await runWriteOrModifyFileTool();
    const event = buildEvent(toolResult);
    const res = await emitToolCompleted(NoopProvenanceSink, event);
    console.log('[noop] tool succeeded; receipt:', res.receiptId, res.receiptPath);
  }

  // --- 2. BoundaryAttest adapter sink: redact + hash + sign + write + verify ---
  {
    const sink = new BoundaryAttestProvenanceSink({
      enabled: true,
      signer,
      receiptRole: 'client_observed',
      outDir: RECEIPTS_DIR,
    });

    const toolResult = await runWriteOrModifyFileTool();
    const event = buildEvent(toolResult);
    const res = await emitToolCompleted(sink, event);

    console.log('\n[adapter] receipt written to:', res.receiptPath);
    console.log('[adapter] signed claim:');
    console.log(JSON.stringify(res.receipt.claim, null, 2));

    // Confirm secrets/raw content did NOT leak into the claim.
    const claimStr = JSON.stringify(res.receipt.claim);
    const leaked =
      claimStr.includes('super-secret-value') ||
      claimStr.includes('export function start');
    console.log('[adapter] secrets/raw content leaked into claim:', leaked);

    // Verifier check (outside the runtime): signature must validate.
    const verdict = verifySignedReceipt(res.receipt, signer);
    console.log('[adapter] verify:', verdict);

    // Tamper check: mutate a field and confirm verification fails.
    const tampered = { ...res.receipt, claim: { ...res.receipt.claim, target_ref: 'path:evil.ts' } };
    const tamperVerdict = verifySignedReceipt(tampered, signer);
    console.log('[adapter] verify after tamper (expect ok:false):', tamperVerdict);
  }

  // --- 3. Fail-open: a throwing sink must not break the tool result ---
  {
    /** @type {import('./sink.mjs').ProvenanceSink} */
    const brokenSink = {
      name: 'broken',
      async onToolCompleted() {
        throw new Error('sink exploded');
      },
    };
    const toolResult = await runWriteOrModifyFileTool();
    const event = buildEvent(toolResult);
    const res = await emitToolCompleted(brokenSink, event);
    console.log('\n[fail-open] tool still returns; receipt:', res.receiptId, '(sink error was swallowed)');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('example failed:', err);
  process.exit(1);
});
