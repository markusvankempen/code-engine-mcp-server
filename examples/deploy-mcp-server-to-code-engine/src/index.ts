#!/usr/bin/env node
/**
 * Code Engine MCP Server
 * Model Context Protocol server for IBM Code Engine and Docker/Podman integration
 *
 * Author: Markus van Kempen | markus.van.kempen@gmail.com
 * Research | Floor 7½ 🏢🤏 | https://markusvankempen.github.io/
 * No bug too small, no syntax too weird.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { deployToCodeEngine } from './deploy-tool.js';
import axios from 'axios';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from the workspace root (parent of this package) and from the package dir
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '../.env'), quiet: true });

const execFileAsync = promisify(execFile);

// ── Input validation helpers ───────────────────────────────────────────────
// All container-facing user inputs are validated before they reach any shell
// or execFile call, preventing command injection.

function validateRuntime(r: unknown): string {
  const s = String(r || 'docker');
  if (s !== 'docker' && s !== 'podman') throw new Error(`Invalid container runtime "${s}" — must be "docker" or "podman"`);
  return s;
}

// Image names: registry/namespace/name:tag or name@sha256:digest
function validateImageName(v: unknown): string {
  const s = String(v || '');
  if (!s || !/^[a-zA-Z0-9._\-/:@]+$/.test(s)) throw new Error(`Invalid image name "${s}"`);
  return s;
}

// Container IDs: short hex, full hex, or alphanumeric container name
function validateContainerId(v: unknown): string {
  const s = String(v || '');
  if (!s || !/^[a-zA-Z0-9_.\-]+$/.test(s)) throw new Error(`Invalid container ID/name "${s}"`);
  return s;
}

// Port mappings: hostPort:containerPort, e.g. 8080:8080
function validatePortMapping(v: unknown): string {
  const s = String(v || '');
  if (!s || !/^\d{1,5}:\d{1,5}$/.test(s)) throw new Error(`Invalid port mapping "${s}" — expected "hostPort:containerPort"`);
  return s;
}

// Environment variable names: POSIX identifier rules
function validateEnvKey(v: unknown): string {
  const s = String(v || '');
  if (!s || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`Invalid environment variable name "${s}"`);
  return s;
}

// Registry hostnames: hostname[:port]
function validateRegistryHost(v: unknown): string {
  const s = String(v || '');
  if (!s || !/^[a-zA-Z0-9._\-]+(:\d+)?$/.test(s)) throw new Error(`Invalid registry hostname "${s}"`);
  return s;
}

// Run registry login by piping the password via stdin — never via echo|pipe shell interpolation
function spawnWithStdin(cmd: string, args: string[], stdinData: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command "${cmd} ${args.join(' ')}" exited with code ${code}: ${stderr || stdout}`));
    });
    proc.on('error', reject);
    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

const CE_REGIONS = ['us-south', 'us-east', 'eu-de', 'eu-gb', 'jp-tok', 'jp-osa', 'au-syd', 'ca-tor', 'br-sao'];

// Helper function to get IAM token
async function getIAMToken(apiKey: string): Promise<string> {
  const response = await axios.post(
    'https://iam.cloud.ibm.com/identity/token',
    new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: apiKey
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return response.data.access_token;
}

// Helper: resolve which region a project lives in
async function getProjectRegion(projectId: string, token: string): Promise<string> {
  for (const region of CE_REGIONS) {
    try {
      await axios.get(
        `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return region;
    } catch {
      // not in this region
    }
  }
  throw new Error(`Project ${projectId} not found in any region`);
}

// Helper: get authenticated CE API base URL for a project
async function ceApi(projectId: string, token: string): Promise<{ base: string; headers: Record<string, string> }> {
  const region = await getProjectRegion(projectId, token);
  return {
    base: `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
}

// Helper: get and validate API key
function getApiKey(): string {
  const apiKey = process.env.IBMCLOUD_API_KEY;
  if (!apiKey) throw new Error('IBMCLOUD_API_KEY environment variable not set');
  return apiKey;
}

// Helper: resolve project ID from a name or ID string.
// If the value looks like a UUID (contains hyphens and is long) treat it as an ID.
// Otherwise search all regions for a project whose name matches (case-insensitive).
async function resolveProjectId(nameOrId: string, token: string): Promise<string> {
  // UUID pattern: 8-4-4-4-12
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
    return nameOrId;
  }
  const found: Array<{ id: string; name: string; region: string }> = [];
  await Promise.allSettled(CE_REGIONS.map(async (reg) => {
    try {
      const res = await axios.get(
        `https://api.${reg}.codeengine.cloud.ibm.com/v2/projects`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      (res.data.projects || []).forEach((p: any) => {
        if (p.name.toLowerCase() === nameOrId.toLowerCase()) found.push({ id: p.id, name: p.name, region: reg });
      });
    } catch { /* skip region */ }
  }));
  if (found.length === 0) throw new Error(`No Code Engine project found with name "${nameOrId}". Use ce_list_projects to find it.`);
  if (found.length > 1) throw new Error(`Multiple projects named "${nameOrId}" found in regions: ${found.map(p => p.region).join(', ')}. Provide the project ID instead.`);
  return found[0].id;
}


// Create MCP server
const server = new Server(
  {
    name: 'code-engine-mcp-server',
    version: '1.0.7',
  },
);

// Docker/Podman Tools
const containerTools = [
  {
    name: 'detect_container_runtime',
    description: 'Detect available container runtime (Docker or Podman)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'build_container_image',
    description: 'Build a container image using Docker or Podman',
    inputSchema: {
      type: 'object',
      properties: {
        dockerfile_path: { type: 'string', description: 'Path to Dockerfile' },
        image_name: { type: 'string', description: 'Image name with tag' },
        context_path: { type: 'string', description: 'Build context path' },
        runtime: { type: 'string', enum: ['docker', 'podman'], description: 'Container runtime' },
      },
      required: ['dockerfile_path', 'image_name', 'context_path'],
    },
  },
  {
    name: 'push_container_image',
    description: 'Push container image to registry',
    inputSchema: {
      type: 'object',
      properties: {
        image_name: { type: 'string', description: 'Full image name with registry' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['image_name'],
    },
  },
  {
    name: 'list_local_images',
    description: 'List all local container images',
    inputSchema: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
    },
  },
  {
    name: 'test_container_locally',
    description: 'Run container locally for testing',
    inputSchema: {
      type: 'object',
      properties: {
        image_name: { type: 'string' },
        port_mapping: { type: 'string', description: 'Port mapping (e.g., 8080:8080)' },
        env_vars: { type: 'object', description: 'Environment variables' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['image_name'],
    },
  },
  {
    name: 'get_container_logs',
    description: 'Get logs from a running container',
    inputSchema: {
      type: 'object',
      properties: {
        container_id: { type: 'string' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['container_id'],
    },
  },
  {
    name: 'stop_local_container',
    description: 'Stop and remove a local container',
    inputSchema: {
      type: 'object',
      properties: {
        container_id: { type: 'string' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['container_id'],
    },
  },
  {
    name: 'list_local_containers',
    description: 'List all local containers (running and stopped)',
    inputSchema: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['docker', 'podman'] },
        all: { type: 'boolean', description: 'Include stopped containers' },
      },
    },
  },
  {
    name: 'icr_list_namespaces',
    description: 'List IBM Container Registry (ICR) namespaces in your account',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'ICR region host (default: us.icr.io)', enum: ['us.icr.io', 'uk.icr.io', 'de.icr.io', 'au.icr.io', 'jp.icr.io', 'ca.icr.io'] },
      },
    },
  },
  {
    name: 'icr_list_images',
    description: 'List images in IBM Container Registry (ICR)',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Filter by namespace (optional)' },
        region: { type: 'string', description: 'ICR region host (default: us.icr.io)' },
      },
    },
  },
  {
    name: 'icr_delete_image',
    description: 'Delete an image from IBM Container Registry (ICR) by tag or digest',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Full image reference to delete, e.g. us.icr.io/mynamespace/myapp:v1.0.0' },
        region: { type: 'string', description: 'ICR region host (default: us.icr.io)' },
      },
      required: ['image'],
    },
  },
  {
    name: 'tag_container_image',
    description: 'Tag a local container image with a new name/tag — useful to retag before pushing to ICR',
    inputSchema: {
      type: 'object',
      properties: {
        source_image: { type: 'string', description: 'Existing image name/tag (e.g. myapp:latest)' },
        target_image: { type: 'string', description: 'New image name/tag (e.g. us.icr.io/mynamespace/myapp:v1.0.0)' },
        runtime: { type: 'string', enum: ['docker', 'podman'], description: 'Container runtime (default: auto-detected)' },
      },
      required: ['source_image', 'target_image'],
    },
  },
  {
    name: 'remove_local_image',
    description: 'Remove a local container image to free disk space',
    inputSchema: {
      type: 'object',
      properties: {
        image_name: { type: 'string', description: 'Image name/tag to remove (e.g. us.icr.io/mynamespace/myapp:v1.0.0)' },
        force: { type: 'boolean', description: 'Force removal even if the image is used by a stopped container (default: false)' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['image_name'],
    },
  },
  {
    name: 'login_to_registry',
    description: 'Log in to a container registry (e.g. IBM Container Registry) so images can be pushed/pulled. Uses IBM Cloud IAM token for ICR or username/password for other registries.',
    inputSchema: {
      type: 'object',
      properties: {
        registry: { type: 'string', description: 'Registry hostname (default: us.icr.io for ICR)' },
        username: { type: 'string', description: 'Username — use "iamapikey" for ICR with an IBM Cloud API key' },
        password: { type: 'string', description: 'Password or API key. For ICR leave blank to use IBMCLOUD_API_KEY env var.' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['registry'],
    },
  },
  {
    name: 'inspect_container_image',
    description: 'Inspect a local container image — shows architecture, labels, environment variables, entrypoint, exposed ports, and layer count',
    inputSchema: {
      type: 'object',
      properties: {
        image_name: { type: 'string', description: 'Image name/tag to inspect' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
      required: ['image_name'],
    },
  },
  {
    name: 'prune_images',
    description: 'Remove unused/dangling container images to reclaim disk space. By default removes only dangling images; use all=true to remove all unused images.',
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Remove all unused images, not just dangling ones (default: false)' },
        runtime: { type: 'string', enum: ['docker', 'podman'] },
      },
    },
  },
];

// Code Engine Tools
const codeEngineTools = [
  // --- Projects ---
  {
    name: 'ce_list_projects',
    description: 'List all Code Engine projects across all or a specific region',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'IBM Cloud region (omit to search all regions)' },
      },
    },
  },
  {
    name: 'ce_get_project',
    description: 'Get details of a specific Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (UUID)' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_create_project',
    description: 'Create a new Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        region: { type: 'string', description: 'IBM Cloud region (e.g. us-south, ca-tor)' },
        resource_group_id: { type: 'string', description: 'Resource group ID (optional)' },
      },
      required: ['name', 'region'],
    },
  },
  {
    name: 'ce_delete_project',
    description: 'Delete a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  // --- Applications ---
  {
    name: 'ce_list_applications',
    description: 'List applications in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_get_application',
    description: 'Get details of a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
      },
      required: ['project_id', 'app_name'],
    },
  },
  {
    name: 'ce_create_application',
    description: 'Create a Code Engine application from a container image',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string' },
        image: { type: 'string', description: 'Container image reference' },
        image_secret: { type: 'string', description: 'Registry secret name for pulling the image (e.g. icr-pull-secret)' },
        port: { type: 'number', description: 'Container port (default 8080)' },
        scale_min_instances: { type: 'number', description: 'Min instances (default 0)' },
        scale_max_instances: { type: 'number', description: 'Max instances (default 10)' },
        scale_cpu_limit: { type: 'string', description: 'CPU limit (e.g. 1, 0.5)' },
        scale_memory_limit: { type: 'string', description: 'Memory limit (e.g. 4G, 2G)' },
        env_vars: { type: 'object', description: 'Key/value environment variables' },
        run_args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the container entrypoint (run_arguments). Required for supergateway: ["--stdio", "npx -y <mcp-server>", "--outputTransport", "sse"]' },
        run_commands: { type: 'array', items: { type: 'string' }, description: 'Override the container entrypoint (run_commands). Rarely needed — use run_args for passing flags.' },
      },
      required: ['project_id', 'name', 'image'],
    },
  },
  {
    name: 'ce_update_application',
    description: 'Update an existing Code Engine application (image, scaling, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
        image: { type: 'string', description: 'New container image reference' },
        image_secret: { type: 'string', description: 'Registry secret name for pulling the image' },
        scale_min_instances: { type: 'number' },
        scale_max_instances: { type: 'number' },
        scale_cpu_limit: { type: 'string' },
        scale_memory_limit: { type: 'string' },
        run_args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the container entrypoint (run_arguments)' },
        run_commands: { type: 'array', items: { type: 'string' }, description: 'Override the container entrypoint (run_commands)' },
      },
      required: ['project_id', 'app_name'],
    },
  },
  {
    name: 'ce_delete_application',
    description: 'Delete a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
      },
      required: ['project_id', 'app_name'],
    },
  },
  {
    name: 'ce_list_app_instances',
    description: 'List all running instances (pods) of a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
      },
      required: ['project_id', 'app_name'],
    },
  },
  {
    name: 'ce_get_app_instance',
    description: 'Get status details for a specific running instance of a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
        instance_name: { type: 'string', description: 'Instance name (from ce_list_app_instances)' },
      },
      required: ['project_id', 'app_name', 'instance_name'],
    },
  },
  {
    name: 'ce_get_app_logs',
    description: 'Get logs for a Code Engine application. Retrieves logs from all running pods (or a specific instance) via the Code Engine Kubernetes API proxy.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID or name' },
        app_name: { type: 'string', description: 'Application name' },
        instance_name: { type: 'string', description: 'Optional: specific pod/instance name to filter to (e.g. my-app-00001-deployment-abcde). If omitted, logs from all pods are returned.' },
        tail_lines: { type: 'number', description: 'Number of log lines to return per pod (default: 100)' },
      },
      required: ['project_id', 'app_name'],
    },
  },
      },
      required: ['project_id'],
    },
  },
        name: { type: 'string', description: 'Build configuration name' },
        output_image: { type: 'string', description: 'Output image reference (e.g. icr.io/ns/app:v1)' },
        output_secret: { type: 'string', description: 'Registry secret name for push access' },
        source_type: { type: 'string', enum: ['local', 'git'], description: 'Source type (default: local)' },
        strategy_type: { type: 'string', enum: ['dockerfile', 'buildpacks'], description: 'Build strategy (default: dockerfile)' },
        strategy_spec_file: { type: 'string', description: 'Dockerfile path (default: Dockerfile)' },
        strategy_size: { type: 'string', enum: ['small', 'medium', 'large', 'xlarge'], description: 'Build size (default: medium)' },
      },
      required: ['project_id', 'name', 'output_image', 'output_secret'],
    },
  },
        build_name: { type: 'string' },
      },
      required: ['project_id', 'build_name'],
    },
  },
        build_name: { type: 'string' },
      },
      required: ['project_id', 'build_name'],
    },
  },
      },
      required: ['project_id'],
    },
  },
        build_name: { type: 'string', description: 'Name of the build configuration to run' },
        name: { type: 'string', description: 'Optional name for this build run' },
      },
      required: ['project_id', 'build_name'],
    },
  },
        build_run_name: { type: 'string' },
      },
      required: ['project_id', 'build_run_name'],
    },
  },
        build_run_name: { type: 'string' },
      },
      required: ['project_id', 'build_run_name'],
    },
  },
  // --- Jobs ---
  {
    name: 'ce_list_jobs',
    description: 'List job definitions in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_create_job',
    description: 'Create a job definition in Code Engine',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string' },
        image: { type: 'string', description: 'Container image reference' },
        scale_array_spec: { type: 'string', description: 'Array indices (e.g. 0-9 for 10 instances)' },
        scale_cpu_limit: { type: 'string' },
        scale_memory_limit: { type: 'string' },
        env_vars: { type: 'object' },
      },
      required: ['project_id', 'name', 'image'],
    },
  },
  {
    name: 'ce_create_job_run',
    description: 'Submit a job run from an existing job definition',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_name: { type: 'string', description: 'Job definition name to run' },
        name: { type: 'string', description: 'Optional name for this job run' },
      },
      required: ['project_id', 'job_name'],
    },
  },
  {
    name: 'ce_get_job',
    description: 'Get details of a specific Code Engine job definition',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_name: { type: 'string' },
      },
      required: ['project_id', 'job_name'],
    },
  },
  {
    name: 'ce_delete_job',
    description: 'Delete a Code Engine job definition',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_name: { type: 'string' },
      },
      required: ['project_id', 'job_name'],
    },
  },
  {
    name: 'ce_list_job_runs',
    description: 'List job runs in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_name: { type: 'string', description: 'Filter by job definition name (optional)' },
        limit: { type: 'number', description: 'Maximum results to return' },
        start: { type: 'string', description: 'Pagination token' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_get_job_run',
    description: 'Get status and details of a job run',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_run_name: { type: 'string' },
      },
      required: ['project_id', 'job_run_name'],
    },
  },
  {
    name: 'ce_delete_job_run',
    description: 'Delete a Code Engine job run',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_run_name: { type: 'string' },
      },
      required: ['project_id', 'job_run_name'],
    },
  },
  // --- Secrets ---
  {
    name: 'ce_list_secrets',
    description: 'List secrets in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_create_secret',
    description: 'Create a secret in a Code Engine project (generic, registry, ssh_auth, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string' },
        format: { type: 'string', enum: ['generic', 'ssh_auth', 'basic_auth', 'tls', 'registry'], description: 'Secret type' },
        data: { type: 'object', description: 'Key/value pairs (values must be base64 encoded for binary formats)' },
      },
      required: ['project_id', 'name', 'format', 'data'],
    },
  },
  {
    name: 'ce_get_secret',
    description: 'Get metadata for a specific secret (keys only, no values)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        secret_name: { type: 'string' },
      },
      required: ['project_id', 'secret_name'],
    },
  },
  {
    name: 'ce_delete_secret',
    description: 'Delete a secret from a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        secret_name: { type: 'string' },
      },
      required: ['project_id', 'secret_name'],
    },
  },
  // --- ConfigMaps ---
  {
    name: 'ce_list_config_maps',
    description: 'List configmaps in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_create_config_map',
    description: 'Create a configmap in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string' },
        data: { type: 'object', description: 'Key/value configuration data' },
      },
      required: ['project_id', 'name', 'data'],
    },
  },
  {
    name: 'ce_get_config_map',
    description: 'Get details of a specific configmap in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        config_map_name: { type: 'string' },
      },
      required: ['project_id', 'config_map_name'],
    },
  },
  {
    name: 'ce_delete_config_map',
    description: 'Delete a configmap from a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        config_map_name: { type: 'string' },
      },
      required: ['project_id', 'config_map_name'],
    },
  },
  {
    name: 'ce_list_domain_mappings',
    description: 'List all custom domain mappings in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_get_domain_mapping',
    description: 'Get details of a specific custom domain mapping',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        domain_name: { type: 'string', description: 'The custom domain name (e.g. starwars.cranfordpub.ca)' },
      },
      required: ['project_id', 'domain_name'],
    },
  },
  {
    name: 'ce_create_domain_mapping',
    description: 'Map a custom domain to a Code Engine application. Requires a TLS secret created with ce_create_tls_secret_from_pem. The domain CNAME must point to custom.<subdomain>.us-south.codeengine.appdomain.cloud (returned by this call).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        domain_name: { type: 'string', description: 'Custom domain (e.g. starwars.cranfordpub.ca)' },
        app_name: { type: 'string', description: 'Code Engine application to route traffic to' },
        tls_secret: { type: 'string', description: 'Name of the TLS secret containing the certificate and key' },
      },
      required: ['project_id', 'domain_name', 'app_name', 'tls_secret'],
    },
  },
  {
    name: 'ce_create_tls_secret_from_pem',
    description: 'Create a TLS secret in Code Engine by reading certificate and key PEM files from disk. Use this after obtaining a cert with certbot. The cert and key are read from the given file paths and stored as a Code Engine secret of format "tls".',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        secret_name: { type: 'string', description: 'Name for the TLS secret (e.g. my-domain-tls)' },
        cert_pem_path: { type: 'string', description: 'Absolute path to the certificate PEM file (e.g. ~/certbot/config/live/<domain>/fullchain.pem)' },
        key_pem_path: { type: 'string', description: 'Absolute path to the private key PEM file (e.g. ~/certbot/config/live/<domain>/privkey.pem)' },
      },
      required: ['project_id', 'secret_name', 'cert_pem_path', 'key_pem_path'],
    },
  },
  {
    name: 'ce_delete_domain_mapping',
    description: 'Delete a custom domain mapping from a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        domain_name: { type: 'string', description: 'The custom domain name to remove' },
      },
      required: ['project_id', 'domain_name'],
    },
  },
  {
    name: 'ce_update_secret',
    description: 'Update an existing Code Engine secret in-place (PATCH). Use ce_renew_tls_secret_from_pem for TLS cert renewal. For generic secrets supply a data object with the new key/value pairs.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        secret_name: { type: 'string', description: 'Name of the secret to update' },
        format: { type: 'string', description: 'Secret format if changing: generic, registry, tls, ssh_auth, basic_auth' },
        data: { type: 'object', description: 'New key/value data to replace the secret contents' },
      },
      required: ['project_id', 'secret_name', 'data'],
    },
  },
  {
    name: 'ce_refresh_icr_pull_secret',
    description: 'Refresh a Code Engine registry pull secret for IBM Container Registry (ICR) using the server\'s own IBM Cloud API key. Automatically deletes the existing secret and recreates it with fresh credentials. Use this when deployments fail with "no_revision_ready" or "unknown" status — a common cause is a stale or expired ICR pull secret. No API key input required — the server uses its own IBMCLOUD_API_KEY.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        secret_name: { type: 'string', description: 'Name of the registry secret to refresh (default: icr-pull-secret)' },
        icr_host: { type: 'string', description: 'ICR registry hostname (default: us.icr.io)' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_renew_tls_secret_from_pem',
    description: 'Renew an existing TLS secret in Code Engine by reading updated PEM files from disk. Use this when a Let\'s Encrypt cert has been renewed (every 90 days). Updates the secret in-place — no need to delete and recreate or update domain mappings.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        secret_name: { type: 'string', description: 'Name of the existing TLS secret to renew' },
        cert_pem_path: { type: 'string', description: 'Path to the renewed fullchain.pem (~ supported)' },
        key_pem_path: { type: 'string', description: 'Path to the renewed privkey.pem (~ supported)' },
      },
      required: ['project_id', 'secret_name', 'cert_pem_path', 'key_pem_path'],
    },
  },
  {
    name: 'ce_wait_for_app_ready',
    description: 'Poll a Code Engine application until its status becomes "ready" or a timeout is reached. Returns immediately when ready. Useful after ce_create_application or ce_update_application to confirm the new revision is live.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
        timeout_seconds: { type: 'number', description: 'Max seconds to wait (default 120)' },
      },
      required: ['project_id', 'app_name'],
    },
  },
        build_run_name: { type: 'string' },
        timeout_seconds: { type: 'number', description: 'Max seconds to wait (default 600)' },
      },
      required: ['project_id', 'build_run_name'],
    },
  },
  {
    name: 'icr_create_namespace',
    description: 'Create a new namespace in IBM Container Registry. Required before pushing images for the first time. Uses the ICR REST API with your IBM Cloud API key.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace name to create (lowercase, alphanumeric and hyphens)' },
        region: { type: 'string', description: 'ICR host (default: us.icr.io)' },
      },
      required: ['namespace'],
    },
  },
  {
    name: 'iam_get_token_info',
    description: 'Get information about the current IBM Cloud IAM token — account ID, subject, expiry time, and remaining validity. Useful for diagnosing authentication failures without exposing the token itself.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ─── Procedures (multi-step workflows) ───────────────────────────────────────
  {
    name: 'proc_build_push_deploy',
    description: 'PROCEDURE: Full container pipeline in one step — auto-detects Podman or Docker, builds for linux/amd64, pushes to IBM Container Registry (ICR), creates or updates a Code Engine application, waits for ready, and returns the public URL. Accepts a project name or ID. Builds the full ICR image path from namespace + app name + tag so you do not need to know ICR URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        context_path: { type: 'string', description: 'Path to the directory containing the Dockerfile (e.g. examples/starwars-splash or ./my-app)' },
        project_id_or_name: { type: 'string', description: 'Code Engine project name (e.g. "my-project") or project ID (UUID). Use ce_list_projects if unsure.' },
        app_name: { type: 'string', description: 'Name for the application in Code Engine (e.g. my-app)' },
        image_secret: { type: 'string', description: 'Name of the registry pull secret in Code Engine (e.g. icr-pull-secret). Created with ce_create_secret format=registry.' },
        icr_namespace: { type: 'string', description: 'Your IBM Container Registry namespace (e.g. my-namespace). Use icr_list_namespaces to find it.' },
        image_tag: { type: 'string', description: 'Image version tag (e.g. v1.0.0 or latest). Defaults to "latest".' },
        icr_host: { type: 'string', description: 'ICR host (default: us.icr.io — leave blank unless using a different region)' },
        port: { type: 'number', description: 'Container port the app listens on (default 8080)' },
        scale_min_instances: { type: 'number', description: 'Minimum running instances (default 0 = scale to zero)' },
        scale_max_instances: { type: 'number', description: 'Maximum running instances (default 10)' },
        env_vars: { type: 'object', description: 'Key/value environment variables to set on the app' },
        timeout_seconds: { type: 'number', description: 'Max seconds to wait for app ready (default 180)' },
      },
      required: ['context_path', 'project_id_or_name', 'app_name', 'image_secret', 'icr_namespace'],
    },
  },
  {
    name: 'proc_setup_custom_domain',
    description: 'PROCEDURE: Custom domain setup in one step — reads TLS certificate PEM files from disk (e.g. from certbot/Let\'s Encrypt), creates a TLS secret in Code Engine, then creates the domain mapping. Returns the CNAME target value to add in your DNS provider.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id_or_name: { type: 'string', description: 'Code Engine project name or ID' },
        app_name: { type: 'string', description: 'The Code Engine app to map the custom domain to' },
        domain_name: { type: 'string', description: 'Your custom domain (e.g. myapp.example.com)' },
        tls_secret_name: { type: 'string', description: 'Name to give the TLS secret in Code Engine (e.g. myapp-tls). Must be unique in the project.' },
        cert_pem_path: { type: 'string', description: 'Path to the certificate chain PEM file — typically ~/certbot/config/live/<domain>/fullchain.pem' },
        key_pem_path: { type: 'string', description: 'Path to the private key PEM file — typically ~/certbot/config/live/<domain>/privkey.pem' },
      },
      required: ['project_id_or_name', 'app_name', 'domain_name', 'tls_secret_name', 'cert_pem_path', 'key_pem_path'],
    },
  },
        build_name: { type: 'string', description: 'Name of the existing Code Engine build configuration to run (use ce_list_builds to find it)' },
        app_name: { type: 'string', description: 'Application to create or update after the build succeeds' },
        image_secret: { type: 'string', description: 'Registry pull secret name in Code Engine (e.g. icr-pull-secret)' },
        port: { type: 'number', description: 'Container port the app listens on (default 8080)' },
        build_timeout_seconds: { type: 'number', description: 'Max seconds to wait for the build to finish (default 600)' },
        deploy_timeout_seconds: { type: 'number', description: 'Max seconds to wait for the app to become ready (default 180)' },
      },
      required: ['project_id_or_name', 'build_name', 'app_name', 'image_secret'],
    },
  },

  // ─── App Revisions ────────────────────────────────────────────────────────────
  {
    name: 'ce_list_app_revisions',
    description: 'List all revisions (deployed versions) of a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
      },
      required: ['project_id', 'app_name'],
    },
  },
  {
    name: 'ce_get_app_revision',
    description: 'Get details of a specific revision of a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
        revision_name: { type: 'string' },
      },
      required: ['project_id', 'app_name', 'revision_name'],
    },
  },
  {
    name: 'ce_delete_app_revision',
    description: 'Delete a specific revision of a Code Engine application',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        app_name: { type: 'string' },
        revision_name: { type: 'string' },
      },
      required: ['project_id', 'app_name', 'revision_name'],
    },
  },

  // ─── Update operations ────────────────────────────────────────────────────────
  {
    name: 'ce_update_job',
    description: 'Update an existing Code Engine job definition (PATCH)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        job_name: { type: 'string' },
        image: { type: 'string', description: 'New container image reference' },
        image_secret: { type: 'string' },
        scale_array_spec: { type: 'string', description: 'Array indices to run (e.g. "0-9")' },
        scale_cpu_limit: { type: 'string' },
        scale_memory_limit: { type: 'string' },
        env_vars: { type: 'object', description: 'Key/value environment variables' },
      },
      required: ['project_id', 'job_name'],
    },
  },
        build_name: { type: 'string' },
        output_image: { type: 'string' },
        output_secret: { type: 'string' },
        source_url: { type: 'string' },
        source_revision: { type: 'string' },
        strategy_size: { type: 'string', enum: ['small', 'medium', 'large', 'xlarge', 'xxlarge'] },
        strategy_spec_file: { type: 'string', description: 'Path to Dockerfile or buildpacks config (default: Dockerfile)' },
      },
      required: ['project_id', 'build_name'],
    },
  },
  {
    name: 'ce_update_config_map',
    description: 'Update an existing Code Engine configmap (PATCH)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        config_map_name: { type: 'string' },
        data: { type: 'object', description: 'New key/value data to replace configmap contents' },
      },
      required: ['project_id', 'config_map_name', 'data'],
    },
  },
  {
    name: 'ce_update_domain_mapping',
    description: 'Update an existing Code Engine custom domain mapping (PATCH) — e.g. change the target app',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        domain_name: { type: 'string' },
        app_name: { type: 'string', description: 'New application to route traffic to' },
        tls_secret: { type: 'string', description: 'New TLS secret name (optional)' },
      },
      required: ['project_id', 'domain_name'],
    },
  },

      },
      required: [],
    },
  },
      },
      required: ['project_id'],
    },
  },
        function_name: { type: 'string' },
      },
      required: ['project_id', 'function_name'],
    },
  },
        name: { type: 'string' },
        runtime: { type: 'string', description: 'Runtime identifier (e.g. nodejs-20, python-3.11). Use ce_list_function_runtimes to see all options.' },
        code_reference: { type: 'string', description: 'Inline code as a data URL or reference to a code bundle image' },
        code_main: { type: 'string', description: 'Entry point function name (default: main)' },
        scale_concurrency: { type: 'number', description: 'Max requests per instance (default: 1)' },
        scale_cpu_limit: { type: 'string', description: 'CPU limit (default: 1)' },
        scale_memory_limit: { type: 'string', description: 'Memory limit (default: 4G)' },
        env_vars: { type: 'object', description: 'Key/value environment variables' },
      },
      required: ['project_id', 'name', 'runtime', 'code_reference'],
    },
  },
        function_name: { type: 'string' },
        runtime: { type: 'string' },
        code_reference: { type: 'string' },
        code_main: { type: 'string' },
        scale_concurrency: { type: 'number' },
        scale_cpu_limit: { type: 'string' },
        scale_memory_limit: { type: 'string' },
        env_vars: { type: 'object' },
      },
      required: ['project_id', 'function_name'],
    },
  },
        function_name: { type: 'string' },
      },
      required: ['project_id', 'function_name'],
    },
  },

  // ─── Service Bindings ─────────────────────────────────────────────────────────
  {
    name: 'ce_list_bindings',
    description: 'List all service bindings in a Code Engine project (bindings connect IBM Cloud services to apps/jobs)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_create_binding',
    description: 'Create a service binding to connect an IBM Cloud service instance to a Code Engine component',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        component_name: { type: 'string', description: 'Name of the CE app or job to bind the service to' },
        component_resource_type: { type: 'string', enum: ['app_v2', 'job_v2', 'function_v2'], description: 'Resource type of the component' },
        secret_name: { type: 'string', description: 'Name of the operator secret referencing the IBM Cloud service instance' },
        prefix: { type: 'string', description: 'Prefix for environment variable names injected into the component (optional)' },
      },
      required: ['project_id', 'component_name', 'component_resource_type', 'secret_name'],
    },
  },
  {
    name: 'ce_get_binding',
    description: 'Get details of a specific service binding in a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        binding_id: { type: 'string', description: 'The binding ID (use ce_list_bindings to find it)' },
      },
      required: ['project_id', 'binding_id'],
    },
  },
  {
    name: 'ce_delete_binding',
    description: 'Delete a service binding from a Code Engine project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        binding_id: { type: 'string' },
      },
      required: ['project_id', 'binding_id'],
    },
  },

  // ─── Project extras ────────────────────────────────────────────────────────────
  {
    name: 'ce_get_project_status',
    description: 'Get the status details of a Code Engine project (readiness, enabled components, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'ce_list_egress_ips',
    description: 'List the public egress IP addresses used by a Code Engine project (useful for allowlisting in firewalls)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
      },
      required: ['project_id'],
    },
  },
        name: { type: 'string', description: 'Name for this allowed outbound destination rule' },
        type: { type: 'string', enum: ['cidr_block', 'fqdn'], description: 'Type of destination: CIDR block or fully-qualified domain name' },
        cidr_block: { type: 'string', description: 'CIDR block (required when type=cidr_block, e.g. 1.2.3.4/24)' },
        fqdn: { type: 'string', description: 'Fully-qualified domain name (required when type=fqdn, e.g. example.com)' },
      },
      required: ['project_id', 'name', 'type'],
    },
  },
        destination_name: { type: 'string' },
      },
      required: ['project_id', 'destination_name'],
    },
  },
        destination_name: { type: 'string' },
        cidr_block: { type: 'string', description: 'New CIDR block value' },
        fqdn: { type: 'string', description: 'New FQDN value' },
      },
      required: ['project_id', 'destination_name'],
    },
  },
        destination_name: { type: 'string' },
      },
      required: ['project_id', 'destination_name'],
    },
  },

      },
      required: ['project_id'],
    },
  },
        name: { type: 'string', description: 'Name for this persistent data store' },
        secret_name: { type: 'string', description: 'Name of the secret containing COS credentials' },
        bucket_name: { type: 'string', description: 'COS bucket name to bind' },
        endpoint: { type: 'string', description: 'COS endpoint URL (e.g. https://s3.us-south.cloud-object-storage.appdomain.cloud)' },
      },
      required: ['project_id', 'name', 'secret_name', 'bucket_name'],
    },
  },
        data_store_name: { type: 'string' },
      },
      required: ['project_id', 'data_store_name'],
    },
  },
        data_store_name: { type: 'string' },
      },
      required: ['project_id', 'data_store_name'],
    },
  },

      },
      required: ['project_id'],
    },
  },
        name: { type: 'string' },
        image: { type: 'string', description: 'Container image reference' },
        image_secret: { type: 'string' },
        scale_cpu_limit: { type: 'string' },
        scale_memory_limit: { type: 'string' },
        env_vars: { type: 'object' },
      },
      required: ['project_id', 'name', 'image'],
    },
  },
        fleet_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id'],
    },
  },
        fleet_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id'],
    },
  },
        fleet_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id'],
    },
  },

        fleet_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id'],
    },
  },
        fleet_id: { type: 'string' },
        task_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id', 'task_id'],
    },
  },

        fleet_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id'],
    },
  },
        fleet_id: { type: 'string' },
        worker_id: { type: 'string' },
      },
      required: ['project_id', 'fleet_id', 'worker_id'],
    },
  },

      },
      required: ['project_id'],
    },
  },
        name: { type: 'string' },
        cidr: { type: 'string', description: 'CIDR block for the subnet pool (e.g. 10.0.0.0/24)' },
      },
      required: ['project_id', 'name', 'cidr'],
    },
  },
        subnet_pool_id: { type: 'string' },
      },
      required: ['project_id', 'subnet_pool_id'],
    },
  },
        subnet_pool_id: { type: 'string' },
      },
      required: ['project_id', 'subnet_pool_id'],
    },
  },
];

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...containerTools, ...codeEngineTools],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    return {
      content: [
      ],
      isError: true,
    };
  }

  try {
    switch (name) {

      case 'detect_container_runtime': {
        const { stdout: dockerVersion } = await execFileAsync('docker', ['--version']).catch(() => ({ stdout: '' }));
        const { stdout: podmanVersion } = await execFileAsync('podman', ['--version']).catch(() => ({ stdout: '' }));
        
        return {
          content: [
          ],
        };
      }

      case 'build_container_image': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const imageName = validateImageName(args.image_name);
        const buildArgs = ['build', '-t', imageName];
        if (args.dockerfile_path) buildArgs.push('-f', args.dockerfile_path as string);
        buildArgs.push((args.context_path as string) || '.');
        const { stdout, stderr } = await execFileAsync(runtime, buildArgs);
        // Container runtimes write build progress to stderr — label it clearly
        const build_output = [stdout, stderr].filter(Boolean).join('\n').trim();
        return {
          content: [
          ],
        };
      }

      case 'push_container_image': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const imageName = validateImageName(args.image_name);
        const { stdout, stderr } = await execFileAsync(runtime, ['push', imageName]);
        return {
          content: [
          ],
        };
      }

      case 'list_local_images': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const { stdout } = await execFileAsync(runtime, ['images', '--format', '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}']);
        
        return {
          content: [
          ],
        };
      }

      case 'test_container_locally': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const runArgs = ['run', '-d'];
        if (args.port_mapping) {
          runArgs.push('-p', validatePortMapping(args.port_mapping));
        }
        if (args.env_vars) {
          for (const [key, value] of Object.entries(args.env_vars as Record<string, string>)) {
            // Pass as a single arg: execFile does not invoke a shell so KEY=VALUE is safe
            runArgs.push('-e', `${validateEnvKey(key)}=${value}`);
          }
        }
        runArgs.push(validateImageName(args.image_name));
        const { stdout } = await execFileAsync(runtime, runArgs);
        return {
          content: [
          ],
        };
      }

      case 'get_container_logs': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const { stdout } = await execFileAsync(runtime, ['logs', validateContainerId(args.container_id)]);
        
        return {
          content: [
          ],
        };
      }

      case 'stop_local_container': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const containerId = validateContainerId(args.container_id);
        await execFileAsync(runtime, ['stop', containerId]);
        await execFileAsync(runtime, ['rm', containerId]);
        
        return {
          content: [
          ],
        };
      }

      case 'list_local_containers': {
        const runtime = validateRuntime(args.runtime || 'docker');
        const psArgs = ['ps', '--format', '{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'];
        if (args.all) psArgs.push('-a');
        const { stdout } = await execFileAsync(runtime, psArgs);
        
        return {
          content: [
          ],
        };
      }

      case 'tag_container_image': {
        const runtime = validateRuntime((args.runtime as string) || (await execFileAsync('podman', ['--version']).then(() => 'podman').catch(() => 'docker')));
        const src = validateImageName(args.source_image);
        const tgt = validateImageName(args.target_image);
        await execFileAsync(runtime, ['tag', src, tgt]);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, command: `${runtime} tag ${src} ${tgt}`, source: src, target: tgt }, null, 2) }] };
      }

      case 'remove_local_image': {
        const runtime = validateRuntime((args.runtime as string) || (await execFileAsync('podman', ['--version']).then(() => 'podman').catch(() => 'docker')));
        const rmiArgs = ['rmi'];
        if (args.force) rmiArgs.push('-f');
        rmiArgs.push(validateImageName(args.image_name));
        const { stdout, stderr } = await execFileAsync(runtime, rmiArgs);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, command: `${runtime} ${rmiArgs.join(' ')}`, output: [stdout, stderr].filter(Boolean).join('\n').trim() }, null, 2) }] };
      }

      case 'login_to_registry': {
        const runtime = validateRuntime((args.runtime as string) || (await execFileAsync('podman', ['--version']).then(() => 'podman').catch(() => 'docker')));
        const registry = validateRegistryHost((args.registry as string) || 'us.icr.io');
        const username = (args.username as string) || 'iamapikey';
        // Use supplied password, or fall back to IBMCLOUD_API_KEY for ICR
        const password = (args.password as string) || getApiKey();
        // Pipe password via stdin — never via echo|shell to avoid command injection
        const { stdout, stderr } = await spawnWithStdin(runtime, ['login', registry, '-u', username, '--password-stdin'], password);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, registry, username, output: [stdout, stderr].filter(Boolean).join('\n').trim() }, null, 2) }] };
      }

      case 'inspect_container_image': {
        const runtime = validateRuntime((args.runtime as string) || (await execFileAsync('podman', ['--version']).then(() => 'podman').catch(() => 'docker')));
        const { stdout } = await execFileAsync(runtime, ['inspect', validateImageName(args.image_name)]);
        const raw = JSON.parse(stdout);
        const img = Array.isArray(raw) ? raw[0] : raw;
        const summary = {
          id: img.Id?.substring(0, 12),
          created: img.Created,
          architecture: img.Architecture,
          os: img.Os,
          size_mb: img.Size ? (img.Size / 1024 / 1024).toFixed(1) : undefined,
          labels: img.Config?.Labels || img.Labels,
          env: img.Config?.Env,
          entrypoint: img.Config?.Entrypoint,
          cmd: img.Config?.Cmd,
          exposed_ports: img.Config?.ExposedPorts ? Object.keys(img.Config.ExposedPorts) : [],
          layers: img.RootFS?.Layers?.length ?? img.GraphDriver?.Data?.LowerDir?.split(':').length,
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      }

      case 'prune_images': {
        const runtime = validateRuntime((args.runtime as string) || (await execFileAsync('podman', ['--version']).then(() => 'podman').catch(() => 'docker')));
        const pruneArgs = ['image', 'prune', '-f'];
        if (args.all) pruneArgs.push('-a');
        const { stdout, stderr } = await execFileAsync(runtime, pruneArgs);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, command: `${runtime} ${pruneArgs.join(' ')}`, output: [stdout, stderr].filter(Boolean).join('\n').trim() }, null, 2) }] };
      }

      case 'icr_list_namespaces': {
        const apiKey = getApiKey();
        const token = await getIAMToken(apiKey);
        const host = args.region || 'us.icr.io';
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const accountId: string = payload?.account?.bss || '';
        const response = await axios.get(`https://${host}/api/v1/namespaces`, {
          headers: { Authorization: `Bearer ${token}`, Account: accountId },
        });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'icr_list_images': {
        const apiKey = getApiKey();
        const token = await getIAMToken(apiKey);
        const host = args.region || 'us.icr.io';
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const accountId: string = payload?.account?.bss || '';
        const params: Record<string, string> = { includeIBM: 'false' };
        if (args.namespace) params.namespace = args.namespace as string;
        const response = await axios.get(`https://${host}/api/v1/images`, {
          headers: { Authorization: `Bearer ${token}`, Account: accountId },
          params,
        });
        const images = (response.data as any[]).map((img: any) => ({
          tags: img.RepoTags || [],
          digest: img.Id,
          size: img.Size,
          created: img.Created,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(images, null, 2) }] };
      }

      case 'icr_delete_image': {
        const apiKey = getApiKey();
        const token = await getIAMToken(apiKey);
        const host = args.region || 'us.icr.io';
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const accountId: string = payload?.account?.bss || '';
        const response = await axios.delete(
          `https://${host}/api/v1/images/${encodeURIComponent(args.image as string)}`,
          { headers: { Authorization: `Bearer ${token}`, Account: accountId } }
        );
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: args.image, status: response.status }, null, 2) }] };
      }

      case 'ce_list_projects': {
        const apiKey = getApiKey();
        const token = await getIAMToken(apiKey);
        const regionsToCheck = args.region ? [args.region as string] : CE_REGIONS;
        const uniqueProjects = new Map<string, any>();

        await Promise.allSettled(regionsToCheck.map(async (reg) => {
          const response = await axios.get(
            `https://api.${reg}.codeengine.cloud.ibm.com/v2/projects`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (response.data.projects) {
            response.data.projects.forEach((p: any) => {
              if (!uniqueProjects.has(p.id)) uniqueProjects.set(p.id, { ...p, region: reg });
            });
          }
        }));

        const projects = Array.from(uniqueProjects.values());
        return { content: [{ type: 'text', text: JSON.stringify({ projects, total: projects.length }, null, 2) }] };
      }

      case 'ce_get_project': {
        const token = await getIAMToken(getApiKey());
        const region = await getProjectRegion(args.project_id as string, token);
        const response = await axios.get(
          `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${args.project_id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return { content: [{ type: 'text', text: JSON.stringify({ ...response.data, region }, null, 2) }] };
      }

      case 'ce_create_project': {
        const token = await getIAMToken(getApiKey());
        const region = args.region as string;
        const body: any = { name: args.name };
        if (args.resource_group_id) body.resource_group_id = args.resource_group_id;
        const response = await axios.post(
          `https://api.${region}.codeengine.cloud.ibm.com/v2/projects`,
          body,
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_delete_project': {
        const token = await getIAMToken(getApiKey());
        const region = await getProjectRegion(args.project_id as string, token);
        await axios.delete(
          `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${args.project_id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Project ${args.project_id} deleted` }, null, 2) }] };
      }

      case 'ce_list_applications': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/apps`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ applications: response.data.apps || [], total: response.data.apps?.length || 0 }, null, 2) }] };
      }

      case 'ce_get_application': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/apps/${args.app_name}`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_create_application': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const body: any = {
          name: args.name,
          image_reference: args.image,
          image_port: args.port ?? 8080,
          scale_min_instances: args.scale_min_instances ?? 0,
          scale_max_instances: args.scale_max_instances ?? 10,
          scale_cpu_limit: args.scale_cpu_limit ?? '1',
          scale_memory_limit: args.scale_memory_limit ?? '4G',
        };
        if (args.image_secret) body.image_secret = args.image_secret;
        if (args.env_vars) {
          body.run_env_variables = Object.entries(args.env_vars as Record<string, string>).map(([name, value]) => ({
            type: 'literal', name, value,
          }));
        }
        if (args.run_args) body.run_arguments = args.run_args;
        if (args.run_commands) body.run_commands = args.run_commands;
        const response = await axios.post(`${base}/apps`, body, { headers });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_update_application': {
        const token = await getIAMToken(getApiKey());
        const { base } = await ceApi(args.project_id as string, token);
        // CE PATCH requires If-Match with the current entity_tag
        const current = await axios.get(`${base}/apps/${args.app_name}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const entityTag = current.data.entity_tag ?? current.data.resource_version ?? '*';
        const patch: any = {};
        if (args.image) patch.image_reference = args.image;
        if (args.image_secret) patch.image_secret = args.image_secret;
        if (args.scale_min_instances !== undefined) patch.scale_min_instances = args.scale_min_instances;
        if (args.scale_max_instances !== undefined) patch.scale_max_instances = args.scale_max_instances;
        if (args.scale_cpu_limit) patch.scale_cpu_limit = args.scale_cpu_limit;
        if (args.scale_memory_limit) patch.scale_memory_limit = args.scale_memory_limit;
        if (args.run_args) patch.run_arguments = args.run_args;
        if (args.run_commands) patch.run_commands = args.run_commands;
        const response = await axios.patch(`${base}/apps/${args.app_name}`, patch, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/merge-patch+json', 'If-Match': entityTag },
        });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_delete_application': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        await axios.delete(`${base}/apps/${args.app_name}`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Application ${args.app_name} deleted` }, null, 2) }] };
      }

      case 'ce_list_app_instances': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/apps/${args.app_name}/instances`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ instances: response.data.instances || [], total: response.data.instances?.length || 0 }, null, 2) }] };
      }

      case 'ce_get_app_instance': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/apps/${args.app_name}/instances`, { headers });
        const instances: any[] = response.data.instances || [];
        const instance = instances.find((i: any) => i.name === args.instance_name);
        if (!instance) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Instance '${args.instance_name}' not found`, available: instances.map((i: any) => i.name) }, null, 2) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(instance, null, 2) }] };
      }

      case 'ce_get_app_logs': {
        const token = await getIAMToken(getApiKey());
        const projectId = await resolveProjectId(args.project_id as string, token);
        const region = await getProjectRegion(projectId, token);
        const ceHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

        // Get app details to extract namespace/subdomain from the endpoint URL
        const appRes = await axios.get(
          `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}/apps/${args.app_name}`,
          { headers: ceHeaders }
        );
        // Endpoint pattern: https://{app}.{subdomain}.{region}.codeengine.appdomain.cloud
        const endpoint: string = appRes.data.endpoint || '';
        const subdomainMatch = endpoint.match(/https?:\/\/[^.]+\.([^.]+)\.[^.]+\.codeengine/);
        if (!subdomainMatch) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Could not determine project namespace from app endpoint', endpoint }, null, 2) }] };
        }
        const namespace = subdomainMatch[1];
        const proxyBase = `https://proxy.${region}.codeengine.cloud.ibm.com`;
        const tailLines = (args.tail_lines as number) ?? 100;
        const kubeHeaders = { Authorization: `Bearer ${token}` };

        // List pods for the app via Kubernetes API proxy
        const labelSelector = encodeURIComponent(`serving.knative.dev/service=${args.app_name}`);
        const podsRes = await axios.get(
          `${proxyBase}/api/v1/namespaces/${namespace}/pods?labelSelector=${labelSelector}`,
          { headers: kubeHeaders }
        );
        const pods: any[] = podsRes.data.items || [];
        if (pods.length === 0) {
          return { content: [{ type: 'text', text: JSON.stringify({ message: `No pods found for app '${args.app_name}'`, namespace, app: args.app_name }, null, 2) }] };
        }

        // Filter to a specific instance if requested
        const targetPods = args.instance_name
          ? pods.filter((p: any) => p.metadata.name === args.instance_name || p.metadata.name.startsWith(String(args.instance_name)))
          : pods;

        // Fetch logs for each pod
        const results: any[] = [];
        for (const pod of targetPods) {
          const podName: string = pod.metadata.name;
          const podPhase: string = pod.status?.phase ?? 'Unknown';
          try {
            const logRes = await axios.get(
              `${proxyBase}/api/v1/namespaces/${namespace}/pods/${podName}/log?container=user-container&tailLines=${tailLines}`,
              { headers: kubeHeaders }
            );
            results.push({ pod: podName, status: podPhase, logs: logRes.data });
          } catch (logErr: any) {
            results.push({ pod: podName, status: podPhase, error: logErr.response?.data?.message ?? logErr.message });
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ app: args.app_name, namespace, region, pods_found: pods.length, results }, null, 2) }] };
      }




          if (appLast.status === 'failed') {
            return { content: [{ type: 'text', text: JSON.stringify({ steps: steps3, deploy_status: 'failed', reason: appLast.status_details?.reason, status_details: appLast.status_details, app_poll_history: appPollHistory }, null, 2) }], isError: true };
          }
          await new Promise(r => setTimeout(r, 5000));
        }

        return { content: [{ type: 'text', text: JSON.stringify({
          status: appLast.status,
          endpoint: appLast.endpoint,
          image: outputImage,
          latest_ready_revision: appLast.status_details?.latest_ready_revision,
          steps: steps3,
          app_poll_history: appPollHistory,
        }, null, 2) }] };
      }

      // ─── App Revisions ─────────────────────────────────────────────────────────

      case 'ce_list_app_revisions': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/apps/${args.app_name}/revisions`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ revisions: response.data.revisions || [], total: response.data.revisions?.length || 0 }, null, 2) }] };
      }

      case 'ce_get_app_revision': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/apps/${args.app_name}/revisions/${args.revision_name}`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_delete_app_revision': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        await axios.delete(`${base}/apps/${args.app_name}/revisions/${args.revision_name}`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Revision ${args.revision_name} deleted` }, null, 2) }] };
      }

      // ─── Update operations ──────────────────────────────────────────────────────

      case 'ce_update_job': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const current = await axios.get(`${base}/jobs/${args.job_name}`, { headers });
        const etag = current.data.entity_tag;
        const patch: any = {};
        if (args.image) patch.image_reference = args.image;
        if (args.image_secret) patch.image_secret = args.image_secret;
        if (args.scale_array_spec) patch.scale_array_spec = args.scale_array_spec;
        if (args.scale_cpu_limit) patch.scale_cpu_limit = args.scale_cpu_limit;
        if (args.scale_memory_limit) patch.scale_memory_limit = args.scale_memory_limit;
        if (args.env_vars) {
          patch.run_env_variables = Object.entries(args.env_vars as Record<string, string>).map(([name, value]) => ({ type: 'literal', name, value }));
        }
        const response = await axios.patch(`${base}/jobs/${args.job_name}`, patch, {
          headers: { ...headers, 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
        });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }


      case 'ce_update_config_map': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const current = await axios.get(`${base}/config_maps/${args.config_map_name}`, { headers });
        const etag = current.data.entity_tag;
        const response = await axios.patch(`${base}/config_maps/${args.config_map_name}`, { data: args.data }, {
          headers: { ...headers, 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
        });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_update_domain_mapping': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const current = await axios.get(`${base}/domain_mappings/${encodeURIComponent(args.domain_name as string)}`, { headers });
        const etag = current.data.entity_tag;
        const patch: any = {};
        if (args.app_name) patch.component = { resource_type: 'app_v2', name: args.app_name };
        if (args.tls_secret) patch.tls_secret = args.tls_secret;
        const response = await axios.patch(`${base}/domain_mappings/${encodeURIComponent(args.domain_name as string)}`, patch, {
          headers: { ...headers, 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
        });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      // ─── Functions ──────────────────────────────────────────────────────────────







      // ─── Service Bindings ────────────────────────────────────────────────────────

      case 'ce_list_bindings': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/bindings`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ bindings: response.data.bindings || [], total: response.data.bindings?.length || 0 }, null, 2) }] };
      }

      case 'ce_create_binding': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const body: any = {
          component: { resource_type: args.component_resource_type, name: args.component_name },
          secret_name: args.secret_name,
        };
        if (args.prefix) body.prefix = args.prefix;
        const response = await axios.post(`${base}/bindings`, body, { headers });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_get_binding': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/bindings/${args.binding_id}`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_delete_binding': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        await axios.delete(`${base}/bindings/${args.binding_id}`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Binding ${args.binding_id} deleted` }, null, 2) }] };
      }

      // ─── Project extras ─────────────────────────────────────────────────────────

      case 'ce_get_project_status': {
        const token = await getIAMToken(getApiKey());
        const region = await getProjectRegion(args.project_id as string, token);
        const response = await axios.get(
          `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${args.project_id}/status_details`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'ce_list_egress_ips': {
        const token = await getIAMToken(getApiKey());
        const { base, headers } = await ceApi(args.project_id as string, token);
        const response = await axios.get(`${base}/egress_ips`, { headers });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }






      // ─── Persistent Data Stores ─────────────────────────────────────────────────





      // ─── Fleets ─────────────────────────────────────────────────────────────────






      // ─── Fleet Tasks ────────────────────────────────────────────────────────────



      // ─── Fleet Workers ──────────────────────────────────────────────────────────



      // ─── Subnet Pools ────────────────────────────────────────────────────────────





      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Code Engine MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

// Made by MVK
