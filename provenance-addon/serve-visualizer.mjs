#!/usr/bin/env node
/**
 * Static server for visualizer.html with optional live receipts API.
 *
 *   GET /api/receipts/live  → { receipts, publicKey, hint }
 *
 * Usage: node serve-visualizer.mjs [--port 8766]
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.find((a, i) => process.argv[i - 1] === '--port') || process.env.PORT || 8766);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.pem': 'application/x-pem-file',
};

function loadLiveReceipts() {
  const liveDir = join(ROOT, 'receipts', 'live');
  const keyPem = join(ROOT, '.keys', 'public.pem');
  const receipts = [];
  if (existsSync(liveDir)) {
    for (const name of readdirSync(liveDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
      try {
        const json = JSON.parse(readFileSync(join(liveDir, name), 'utf8'));
        if (json?.claim) receipts.push({ name, json });
      } catch { /* skip */ }
    }
  }
  let publicKey = null;
  if (existsSync(keyPem)) {
    try {
      const der = createPublicKey(readFileSync(keyPem, 'utf8')).export({ type: 'spki', format: 'der' });
      publicKey = {
        algorithm: 'Ed25519',
        public_key_spki_base64: Buffer.from(der).toString('base64'),
        public_key_id: '',
      };
    } catch { /* skip */ }
  }
  return {
    receipts,
    publicKey,
    hint: receipts.length
      ? `Loaded ${receipts.length} receipt(s) from receipts/live/`
      : `No receipts in ${liveDir}`,
  };
}

function safePath(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\//, '') || 'visualizer.html';
  const abs = normalize(resolve(ROOT, rel));
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

const server = createServer((req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/api/receipts/live')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(loadLiveReceipts()));
    return;
  }

  const filePath = safePath(url === '/' ? '/visualizer.html' : url);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`Provenance visualizer: http://localhost:${PORT}/visualizer.html`);
  console.log(`Live API:            http://localhost:${PORT}/api/receipts/live`);
  console.log('Press Ctrl+C to stop');
});
