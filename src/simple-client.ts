#!/usr/bin/env node
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../../.env');
dotenv.config({ path: envPath });

// Get API key from environment
const apiKey = process.env.IBMCLOUD_API_KEY || process.env['IBM+Cloud_API_Key'];

if (!apiKey) {
  console.error('❌ Error: IBM Cloud API key not found in .env file');
  console.error('Please add IBMCLOUD_API_KEY=your-key to .env file');
  process.exit(1);
}

console.log('================================================');
console.log('Code Engine MCP Client');
console.log('================================================');
console.log('');
console.log('✅ API Key loaded from .env');
console.log('');

// Helper function to call MCP server
async function callTool(toolName: string, args: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const serverPath = join(__dirname, 'index.js');
    
    // Start server process
    const serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        IBMCLOUD_API_KEY: apiKey,
      },
    });

    let stdout = '';
    let stderr = '';

    serverProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    serverProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    serverProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}: ${stderr}`));
      } else {
        try {
          // Parse JSON-RPC response
          const lines = stdout.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const response = JSON.parse(line);
              if (response.result) {
                resolve(response.result);
                return;
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
          resolve({ output: stdout, error: stderr });
        } catch (error) {
          reject(error);
        }
      }
    });

    // Send JSON-RPC request
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    serverProcess.stdin.end();
  });
}

// Simple command executor
async function executeCommand(command: string, args: string[]) {
  try {
    // Auto-detect runtime once at startup
    let detectedRuntime: string | null = null;
    
    const getRuntime = async (): Promise<string> => {
      if (!detectedRuntime) {
        const detectResult = await callTool('detect_container_runtime', {});
        const runtimeInfo = JSON.parse(detectResult.content[0].text);
        detectedRuntime = runtimeInfo.available;
        if (detectedRuntime === 'none' || !detectedRuntime) {
          throw new Error('No container runtime (docker or podman) found');
        }
      }
      return detectedRuntime!;
    };

    switch (command) {
      case 'detect':
        console.log('Detecting container runtime...');
        const detectResult = await callTool('detect_container_runtime', {});
        console.log(JSON.stringify(detectResult, null, 2));
        break;

      case 'images':
        console.log('Listing local images...');
        const runtime1 = await getRuntime();
        const imagesResult = await callTool('list_local_images', { runtime: runtime1 });
        console.log(JSON.stringify(imagesResult, null, 2));
        break;

      case 'containers':
        console.log('Listing local containers...');
        const runtime2 = await getRuntime();
        const containersResult = await callTool('list_local_containers', { runtime: runtime2, all: true });
        console.log(JSON.stringify(containersResult, null, 2));
        break;

      case 'projects':
        console.log('Listing Code Engine projects...');
        const projectsResult = await callTool('ce_list_projects', {});
        console.log(JSON.stringify(projectsResult, null, 2));
        break;

      case 'build':
        if (args.length < 3) {
          console.log('Usage: build <dockerfile_path> <image_name> <context_path>');
          console.log('Example: build ./Dockerfile myapp:latest .');
          break;
        }
        console.log(`Building image ${args[1]}...`);
        const runtime3 = await getRuntime();
        console.log(`Using ${runtime3} runtime`);
        const buildResult = await callTool('build_container_image', {
          dockerfile_path: args[0],
          image_name: args[1],
          context_path: args[2],
          runtime: runtime3,
        });
        console.log(JSON.stringify(buildResult, null, 2));
        break;

      case 'push':
        if (args.length < 1) {
          console.log('Usage: push <image_name>');
          console.log('Example: push icr.io/namespace/myapp:latest');
          break;
        }
        console.log(`Pushing image ${args[0]}...`);
        const runtime4 = await getRuntime();
        console.log(`Using ${runtime4} runtime`);
        const pushResult = await callTool('push_container_image', {
          image_name: args[0],
          runtime: runtime4,
        });
        console.log(JSON.stringify(pushResult, null, 2));
        break;

      case 'test':
        if (args.length < 1) {
          console.log('Usage: test <image_name> [port_mapping]');
          console.log('Example: test myapp:latest 8080:8080');
          break;
        }
        console.log(`Testing image ${args[0]} locally...`);
        const runtime5 = await getRuntime();
        console.log(`Using ${runtime5} runtime`);
        const testArgs: any = { image_name: args[0], runtime: runtime5 };
        if (args.length > 1) {
          testArgs.port_mapping = args[1];
        }
        const testResult = await callTool('test_container_locally', testArgs);
        console.log(JSON.stringify(testResult, null, 2));
        break;

      case 'logs':
        if (args.length < 1) {
          console.log('Usage: logs <container_id>');
          break;
        }
        console.log(`Getting logs for container ${args[0]}...`);
        const runtime6 = await getRuntime();
        const logsResult = await callTool('get_container_logs', {
          container_id: args[0],
          runtime: runtime6,
        });
        console.log(JSON.stringify(logsResult, null, 2));
        break;

      case 'stop':
        if (args.length < 1) {
          console.log('Usage: stop <container_id>');
          break;
        }
        console.log(`Stopping container ${args[0]}...`);
        const runtime7 = await getRuntime();
        const stopResult = await callTool('stop_local_container', {
          container_id: args[0],
          runtime: runtime7,
        });
        console.log(JSON.stringify(stopResult, null, 2));
        break;

      case 'help':
        console.log('Available commands:');
        console.log('');
        console.log('Docker/Podman:');
        console.log('  detect                                  - Detect container runtime');
        console.log('  images                                  - List local images');
        console.log('  containers                              - List local containers');
        console.log('  build <dockerfile> <name> <context>     - Build container image');
        console.log('  push <image>                            - Push image to registry');
        console.log('  test <image> [port]                     - Test container locally');
        console.log('  logs <container_id>                     - Get container logs');
        console.log('  stop <container_id>                     - Stop container');
        console.log('');
        console.log('Code Engine:');
        console.log('  projects                                - List Code Engine projects');
        console.log('');
        console.log('Other:');
        console.log('  help                                    - Show this help');
        console.log('  exit                                    - Exit');
        console.log('');
        break;

      default:
        console.log(`Unknown command: ${command}`);
        console.log('Type "help" for available commands');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Interactive mode
    console.log('Interactive Mode');
    console.log('Type "help" for available commands');
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'mcp> ',
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      
      if (!input) {
        rl.prompt();
        return;
      }

      if (input === 'exit' || input === 'quit') {
        console.log('Goodbye!');
        rl.close();
        process.exit(0);
      }

      const [command, ...cmdArgs] = input.split(' ');
      await executeCommand(command, cmdArgs);
      console.log('');
      rl.prompt();
    });

    rl.on('close', () => {
      console.log('Goodbye!');
      process.exit(0);
    });
  } else {
    // Command mode
    const [command, ...cmdArgs] = args;
    await executeCommand(command, cmdArgs);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Made by MVK
