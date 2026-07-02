#!/usr/bin/env node
/**
 * Keep MCP server and VS Code extension on the same release version.
 * Source of truth: package.json "version" at repo root.
 *
 * Usage: node sync-versions.mjs [version]
 *   node sync-versions.mjs        # sync files to package.json version
 *   node sync-versions.mjs 1.4.0  # bump all targets to 1.4.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = process.argv[2]?.trim() || pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid semver: ${version}`);
  process.exit(1);
}

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function write(path, content) {
  writeFileSync(join(root, path), content, 'utf8');
  console.log(`  updated ${path}`);
}

// Root package.json
const rootPkg = JSON.parse(read('package.json'));
rootPkg.version = version;
write('package.json', `${JSON.stringify(rootPkg, null, 2)}\n`);

// Root package-lock (root package entries only)
let lock = read('package-lock.json');
lock = lock.replace(/("name": "code-engine-mcp-server",\n\s+"version": )"[^"]+"/, `$1"${version}"`);
lock = lock.replace(/(\n\s+"": \{\n\s+"name": "code-engine-mcp-server",\n\s+"version": )"[^"]+"/, `$1"${version}"`);
write('package-lock.json', lock);

// MCP Registry manifest
let serverJson = read('server.json');
serverJson = serverJson.replace(/"version": "[^"]+"/g, `"version": "${version}"`);
write('server.json', serverJson);

// Server runtime metadata
let indexTs = read('src/index.ts');
indexTs = indexTs.replace(/version: '[^']+'/, `version: '${version}'`);
write('src/index.ts', indexTs);

// VS Code extension
let extPkg = JSON.parse(read('vscode-extension/package.json'));
extPkg.version = version;
write('vscode-extension/package.json', `${JSON.stringify(extPkg, null, 2)}\n`);

let extLock = read('vscode-extension/package-lock.json');
extLock = extLock.replace(/("name": "code-engine-mcp",\n\s+"version": )"[^"]+"/, `$1"${version}"`);
extLock = extLock.replace(/(\n\s+"": \{\n\s+"name": "code-engine-mcp",\n\s+"version": )"[^"]+"/, `$1"${version}"`);
write('vscode-extension/package-lock.json', extLock);

// Bundled server inside extension
let bundledPkg = JSON.parse(read('vscode-extension/server/package.json'));
bundledPkg.version = version;
write('vscode-extension/server/package.json', `${JSON.stringify(bundledPkg, null, 2)}\n`);

let bundledServerJson = read('vscode-extension/server/server.json');
bundledServerJson = bundledServerJson.replace(/"version": "[^"]+"/g, `"version": "${version}"`);
write('vscode-extension/server/server.json', bundledServerJson);

console.log(`\nAll release targets set to ${version}`);
console.log('Next: npm run build && cd vscode-extension && npm run package');
