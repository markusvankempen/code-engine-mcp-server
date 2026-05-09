/**
 * MCP Server — Tool Discovery Tests
 *
 * Starts the built MCP server as a child process and communicates over
 * JSON-RPC (stdio) to verify the tool list without requiring IBM Cloud
 * credentials.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '../build/index.js');

// Expected tool names exported by the server
const EXPECTED_CONTAINER_TOOLS = [
  'detect_container_runtime',
  'build_container_image',
  'push_container_image',
  'list_local_images',
  'test_container_locally',
  'get_container_logs',
  'stop_local_container',
  'list_local_containers',
  'ce_validate_dockerfile',
];

const EXPECTED_ICR_TOOLS = [
  'icr_list_namespaces',
  'icr_list_images',
  'icr_delete_image',
];

const EXPECTED_CE_TOOLS = [
  'ce_list_projects',
  'ce_get_project',
  'ce_create_project',
  'ce_delete_project',
  'ce_list_applications',
  'ce_get_application',
  'ce_create_application',
  'ce_update_application',
  'ce_delete_application',
  'ce_list_app_instances',
  'ce_get_app_instance',
  'ce_get_app_logs',
];

/** Send JSON-RPC initialize + tools/list to the MCP server and return tool names */
function discoverTools(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, IBMCLOUD_API_KEY: 'test-key-not-real' },
    });

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MCP server timed out after 10s'));
    }, 10000);

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            clearTimeout(timer);
            child.kill();
            resolve((msg.result.tools as Array<{ name: string }>).map((t) => t.name));
            return;
          }
        } catch {
          // incomplete line — keep buffering
        }
      }
    });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with code ${code} before returning tools`));
    });

    // MCP handshake
    child.stdin!.write(
      JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jest', version: '1.0' } },
      }) + '\n'
    );
    child.stdin!.write(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n'
    );
  });
}

describe('MCP Server — tool discovery', () => {
  let tools: string[];

  beforeAll(async () => {
    tools = await discoverTools();
  }, 15000);

  test('returns a non-empty tool list', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  test.each(EXPECTED_CONTAINER_TOOLS)('container tool "%s" is registered', (name) => {
    expect(tools).toContain(name);
  });

  test.each(EXPECTED_ICR_TOOLS)('ICR tool "%s" is registered', (name) => {
    expect(tools).toContain(name);
  });

  test.each(EXPECTED_CE_TOOLS)('Code Engine tool "%s" is registered', (name) => {
    expect(tools).toContain(name);
  });

  test('all tool names are non-empty strings', () => {
    for (const name of tools) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('no duplicate tool names', () => {
    const unique = new Set(tools);
    expect(unique.size).toBe(tools.length);
  });
});
