#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });
// Create MCP client
const client = new Client({
    name: 'code-engine-cli-client',
    version: '1.0.0',
}, {
    capabilities: {},
});
// Start the MCP server as a subprocess
const serverPath = join(__dirname, 'index.js');
const serverProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
        ...process.env,
        IBMCLOUD_API_KEY: process.env['IBM+Cloud_API_Key'] || process.env.IBMCLOUD_API_KEY,
    },
});
// Connect client to server
const transport = new StdioClientTransport({
    reader: serverProcess.stdout,
    writer: serverProcess.stdin,
});
async function main() {
    try {
        await client.connect(transport);
        console.log('✅ Connected to Code Engine MCP Server');
        console.log('');
        // List available tools
        const tools = await client.listTools();
        console.log('📦 Available Tools:');
        console.log('');
        console.log('Docker/Podman Tools:');
        tools.tools
            .filter(t => !t.name.startsWith('ce_'))
            .forEach(tool => {
            console.log(`  • ${tool.name}: ${tool.description}`);
        });
        console.log('');
        console.log('Code Engine Tools:');
        tools.tools
            .filter(t => t.name.startsWith('ce_'))
            .forEach(tool => {
            console.log(`  • ${tool.name}: ${tool.description}`);
        });
        console.log('');
        console.log('================================================');
        console.log('Interactive MCP Client');
        console.log('================================================');
        console.log('');
        console.log('Commands:');
        console.log('  list                    - List all available tools');
        console.log('  call <tool> <args>      - Call a tool with JSON arguments');
        console.log('  detect                  - Detect container runtime');
        console.log('  images                  - List local images');
        console.log('  containers              - List local containers');
        console.log('  projects                - List Code Engine projects');
        console.log('  help                    - Show this help');
        console.log('  exit                    - Exit the client');
        console.log('');
        // Interactive prompt
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
            const [command, ...args] = input.split(' ');
            try {
                switch (command) {
                    case 'exit':
                    case 'quit':
                        console.log('Goodbye!');
                        rl.close();
                        serverProcess.kill();
                        process.exit(0);
                        break;
                    case 'help':
                        console.log('');
                        console.log('Available commands:');
                        console.log('  list                    - List all available tools');
                        console.log('  call <tool> <args>      - Call a tool with JSON arguments');
                        console.log('  detect                  - Detect container runtime');
                        console.log('  images                  - List local images');
                        console.log('  containers              - List local containers');
                        console.log('  projects                - List Code Engine projects');
                        console.log('  help                    - Show this help');
                        console.log('  exit                    - Exit the client');
                        console.log('');
                        break;
                    case 'list':
                        const toolsList = await client.listTools();
                        console.log('');
                        console.log('Available tools:');
                        toolsList.tools.forEach(tool => {
                            console.log(`  • ${tool.name}: ${tool.description}`);
                        });
                        console.log('');
                        break;
                    case 'detect':
                        console.log('Detecting container runtime...');
                        const detectResult = await client.callTool({
                            name: 'detect_container_runtime',
                            arguments: {},
                        });
                        console.log(detectResult.content[0].text);
                        console.log('');
                        break;
                    case 'images':
                        console.log('Listing local images...');
                        const imagesResult = await client.callTool({
                            name: 'list_local_images',
                            arguments: {},
                        });
                        console.log(imagesResult.content[0].text);
                        console.log('');
                        break;
                    case 'containers':
                        console.log('Listing local containers...');
                        const containersResult = await client.callTool({
                            name: 'list_local_containers',
                            arguments: { all: true },
                        });
                        console.log(containersResult.content[0].text);
                        console.log('');
                        break;
                    case 'projects':
                        console.log('Listing Code Engine projects...');
                        const projectsResult = await client.callTool({
                            name: 'ce_list_projects',
                            arguments: {},
                        });
                        console.log(projectsResult.content[0].text);
                        console.log('');
                        break;
                    case 'call':
                        if (args.length < 1) {
                            console.log('Usage: call <tool_name> <json_arguments>');
                            console.log('Example: call build_container_image \'{"dockerfile_path":"./Dockerfile","image_name":"myapp:latest","context_path":"."}\'');
                            break;
                        }
                        const toolName = args[0];
                        const toolArgs = args.length > 1 ? JSON.parse(args.slice(1).join(' ')) : {};
                        console.log(`Calling ${toolName}...`);
                        const result = await client.callTool({
                            name: toolName,
                            arguments: toolArgs,
                        });
                        console.log(result.content[0].text);
                        console.log('');
                        break;
                    default:
                        console.log(`Unknown command: ${command}`);
                        console.log('Type "help" for available commands');
                        console.log('');
                }
            }
            catch (error) {
                console.error('Error:', error.message);
                console.log('');
            }
            rl.prompt();
        });
        rl.on('close', () => {
            console.log('Goodbye!');
            serverProcess.kill();
            process.exit(0);
        });
    }
    catch (error) {
        console.error('Failed to connect to MCP server:', error);
        serverProcess.kill();
        process.exit(1);
    }
}
main();
// Made by MVK
//# sourceMappingURL=client.js.map