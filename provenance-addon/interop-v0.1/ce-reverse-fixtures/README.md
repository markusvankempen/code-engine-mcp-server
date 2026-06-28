# Code Engine MCP reverse interop fixtures

Public test material for BoundaryAttest reverse verification (CE-produced receipts verified by an external BA verifier).

**Private key is NOT included.** Only the SPKI public key PEM is committed. The signing key lives in gitignored `.keys/` locally.

## Layout

| Path | Purpose |
|---|---|
| `public.pem` | SPKI Ed25519 public key matching the persisted-key-demo receipts |
| `expected.json` | Receipt files and expected verification results |
| `../receipts/persisted-key-demo/*.json` | Code Engine MCP signed receipts (4 fixtures; relative to `interop-v0.1/`) |

## Public key fingerprint

```
public_key_id: sha256:6e7a3d1d6208531b1595bbcf6a13bc5c08da3966196d5758b71a449aee75a4cc
```

Algorithm: SHA-256 of SPKI DER bytes, prefixed with `sha256:` (BoundaryAttest Interop Profile v0.1).

## Verify locally (Code Engine MCP)

From `provenance-addon/`:

```bash
node verify-receipt.mjs --key interop-v0.1/ce-reverse-fixtures/public.pem receipts/persisted-key-demo/*.json
node interop-v0.1/run-ce-reverse.mjs
```

## Expected results

All four receipts in `receipts/persisted-key-demo/` should **pass** cryptographic verification with `public.pem`.

These receipts use Code Engine claim fields (`tool_name`, `session_id`, `task_id`, `input_hash`, `output_hash`, `error_hash`, etc.) beyond the BA interop minimum — verifiers should ignore unknown fields per the interop profile.
