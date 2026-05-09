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
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// Load .env from the workspace root (parent of this package) and from the package dir
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../.env') });
loadDotenv({ path: resolve(__dirname, '../.env') });
const execAsync = promisify(exec);
const CE_REGIONS = ['us-south', 'us-east', 'eu-de', 'eu-gb', 'jp-tok', 'jp-osa', 'au-syd', 'ca-tor', 'br-sao'];
// Helper function to get IAM token
async function getIAMToken(apiKey) {
    const response = await axios.post('https://iam.cloud.ibm.com/identity/token', new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return response.data.access_token;
}
// Helper: resolve which region a project lives in
async function getProjectRegion(projectId, token) {
    for (const region of CE_REGIONS) {
        try {
            await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
            return region;
        }
        catch {
            // not in this region
        }
    }
    throw new Error(`Project ${projectId} not found in any region`);
}
// Helper: get authenticated CE API base URL for a project
async function ceApi(projectId, token) {
    const region = await getProjectRegion(projectId, token);
    return {
        base: `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}`,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
}
// Helper: get and validate API key
function getApiKey() {
    const apiKey = process.env.IBMCLOUD_API_KEY;
    if (!apiKey)
        throw new Error('IBMCLOUD_API_KEY environment variable not set');
    return apiKey;
}
// Helper: resolve project ID from a name or ID string.
// If the value looks like a UUID (contains hyphens and is long) treat it as an ID.
// Otherwise search all regions for a project whose name matches (case-insensitive).
async function resolveProjectId(nameOrId, token) {
    // UUID pattern: 8-4-4-4-12
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
        return nameOrId;
    }
    const found = [];
    await Promise.allSettled(CE_REGIONS.map(async (reg) => {
        try {
            const res = await axios.get(`https://api.${reg}.codeengine.cloud.ibm.com/v2/projects`, { headers: { Authorization: `Bearer ${token}` } });
            (res.data.projects || []).forEach((p) => {
                if (p.name.toLowerCase() === nameOrId.toLowerCase())
                    found.push({ id: p.id, name: p.name, region: reg });
            });
        }
        catch { /* skip region */ }
    }));
    if (found.length === 0)
        throw new Error(`No Code Engine project found with name "${nameOrId}". Use ce_list_projects to find it.`);
    if (found.length > 1)
        throw new Error(`Multiple projects named "${nameOrId}" found in regions: ${found.map(p => p.region).join(', ')}. Provide the project ID instead.`);
    return found[0].id;
}
// Create MCP server
const server = new Server({
    name: 'code-engine-mcp-server',
    version: '1.0.3',
}, {
    capabilities: {
        tools: {},
    },
});
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
        name: 'ce_validate_dockerfile',
        description: 'Validate a Dockerfile for IBM Code Engine compatibility. Checks architecture (linux/amd64 required), port configuration (8080 required), nginx port sed patterns, base image known issues, and USER/root warnings. Returns a list of errors, warnings, and info messages.',
        inputSchema: {
            type: 'object',
            properties: {
                dockerfile_path: { type: 'string', description: 'Absolute or relative path to the Dockerfile to validate' },
                context_path: { type: 'string', description: 'Build context directory (used to check for .dockerignore, etc.)' },
                expected_port: { type: 'number', description: 'Expected container port (default: 8080 for Code Engine)' },
            },
            required: ['dockerfile_path'],
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
        description: 'Get logs for a specific Code Engine application instance',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
                app_name: { type: 'string' },
                instance_name: { type: 'string', description: 'Instance name (e.g. my-app-00001-deployment-abcde)' },
            },
            required: ['project_id', 'app_name', 'instance_name'],
        },
    },
    // --- Builds ---
    {
        name: 'ce_list_builds',
        description: 'List build configurations in a Code Engine project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
            },
            required: ['project_id'],
        },
    },
    {
        name: 'ce_create_build',
        description: 'Create a build configuration for building container images from source',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
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
    {
        name: 'ce_get_build',
        description: 'Get details of a specific Code Engine build configuration',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
                build_name: { type: 'string' },
            },
            required: ['project_id', 'build_name'],
        },
    },
    {
        name: 'ce_delete_build',
        description: 'Delete a Code Engine build configuration',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
                build_name: { type: 'string' },
            },
            required: ['project_id', 'build_name'],
        },
    },
    // --- Build Runs ---
    {
        name: 'ce_list_build_runs',
        description: 'List build runs in a Code Engine project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
            },
            required: ['project_id'],
        },
    },
    {
        name: 'ce_create_build_run',
        description: 'Start a new build run from an existing build configuration',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
                build_name: { type: 'string', description: 'Name of the build configuration to run' },
                name: { type: 'string', description: 'Optional name for this build run' },
            },
            required: ['project_id', 'build_name'],
        },
    },
    {
        name: 'ce_get_build_run',
        description: 'Get status and details of a build run',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
                build_run_name: { type: 'string' },
            },
            required: ['project_id', 'build_run_name'],
        },
    },
    {
        name: 'ce_delete_build_run',
        description: 'Delete a Code Engine build run',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
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
    {
        name: 'ce_wait_for_build_run',
        description: 'Poll a Code Engine build run until it succeeds or fails. Returns when the build reaches a terminal state. Useful after ce_create_build_run to confirm the build completed before deploying.',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' },
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
    {
        name: 'proc_build_run_and_deploy',
        description: 'PROCEDURE: Code Engine source-to-image build + deploy in one step — starts a build run from an existing build configuration, polls until it succeeds, then creates or updates the application with the new image, and waits for it to become ready. Returns the public URL. The build configuration must already exist (use ce_create_build to set one up).',
        inputSchema: {
            type: 'object',
            properties: {
                project_id_or_name: { type: 'string', description: 'Code Engine project name or ID' },
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
                {
                    type: 'text',
                    text: JSON.stringify({ error: 'Missing arguments' }),
                },
            ],
            isError: true,
        };
    }
    try {
        switch (name) {
            case 'ce_validate_dockerfile': {
                const fs = await import('fs');
                const path = await import('path');
                const os = await import('os');
                const resolvePath = (p) => p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p;
                const dfPath = resolvePath(args.dockerfile_path);
                const expectedPort = args.expected_port || 8080;
                if (!fs.existsSync(dfPath)) {
                    return { content: [{ type: 'text', text: JSON.stringify({ valid: false, errors: [`Dockerfile not found: ${dfPath}`], warnings: [], info: [] }, null, 2) }], isError: true };
                }
                const content = fs.readFileSync(dfPath, 'utf8');
                const lines = content.split('\n');
                const errors = [];
                const warnings = [];
                const info = [];
                // ── 1. Architecture ────────────────────────────────────────────────────
                // FROM --platform must target linux/amd64 or be absent (handled at build time)
                const fromLines = lines.filter(l => /^\s*FROM\s/i.test(l));
                const platformLines = fromLines.filter(l => /--platform/i.test(l));
                const wrongPlatform = platformLines.filter(l => !/--platform\s+linux\/amd64/i.test(l));
                if (wrongPlatform.length > 0) {
                    errors.push(`Architecture mismatch: Code Engine requires linux/amd64. Found: ${wrongPlatform.map(l => l.trim()).join(' | ')}`);
                }
                else if (platformLines.length === 0) {
                    info.push('No --platform in FROM. Ensure you build with --platform linux/amd64 (proc_build_push_deploy does this automatically).');
                }
                else {
                    info.push('Platform: linux/amd64 ✓');
                }
                // ── 2. EXPOSE port ─────────────────────────────────────────────────────
                const exposeLines = lines.filter(l => /^\s*EXPOSE\s/i.test(l));
                const exposedPorts = exposeLines.flatMap(l => l.replace(/^\s*EXPOSE\s+/i, '').trim().split(/\s+/).map(Number).filter(Boolean));
                if (exposedPorts.length === 0) {
                    warnings.push(`No EXPOSE instruction found. Code Engine expects the app to listen on port ${expectedPort}.`);
                }
                else if (!exposedPorts.includes(expectedPort)) {
                    errors.push(`EXPOSE declares port(s) [${exposedPorts.join(', ')}] but Code Engine is configured for port ${expectedPort}. Add: EXPOSE ${expectedPort}`);
                }
                else {
                    info.push(`EXPOSE ${expectedPort} ✓`);
                }
                if (exposedPorts.includes(80)) {
                    warnings.push('Port 80 is EXPOSE\'d. Code Engine does not allow port 80. Use port 8080.');
                }
                // ── 3. nginx port sed patterns ─────────────────────────────────────────
                const runLines = lines.filter(l => /^\s*RUN\s/i.test(l));
                const sedLines = runLines.filter(l => /sed\s+-i/.test(l));
                for (const sl of sedLines) {
                    // Check for exact-space patterns that won't match nginx:alpine's default.conf
                    if (/listen\s{2,}80;/.test(sl)) {
                        errors.push(`Fragile nginx sed pattern detected: "${sl.trim()}"\n  → nginx:alpine uses variable whitespace. Use: sed -i 's/listen[[:space:]]*80;/listen 8080;/g'`);
                    }
                    if (/listen\s*80;/.test(sl) && !/\[\[:space:\]\]/.test(sl) && !/\\s/.test(sl)) {
                        warnings.push(`sed pattern for port 80 may not match nginx:alpine's whitespace. Safer: sed -i 's/listen[[:space:]]*80;/listen 8080;/g'`);
                    }
                }
                // ── 4. Base image issues ───────────────────────────────────────────────
                for (const fl of fromLines) {
                    // arm-only or architecture-specific tags
                    if (/arm64|aarch64|arm\//.test(fl)) {
                        errors.push(`Base image appears to be ARM-specific: "${fl.trim()}". Code Engine requires linux/amd64.`);
                    }
                    // python:latest, node:latest etc are fine but worth noting
                    if (/:latest\s*$/i.test(fl.trim()) || /\s+AS\s+/i.test(fl) === false && !fl.includes(':')) {
                        warnings.push(`Base image uses "latest" or no tag in "${fl.trim()}". Pin to a specific version for reproducible builds.`);
                    }
                }
                // ── 5. Root user warning ──────────────────────────────────────────────
                const userLines = lines.filter(l => /^\s*USER\s/i.test(l));
                if (userLines.length === 0) {
                    warnings.push('No USER instruction. Container runs as root by default. Consider adding a non-root USER for security.');
                }
                else {
                    const rootUser = userLines.find(l => /\broot\b|USER\s+0\b/.test(l));
                    if (rootUser) {
                        warnings.push(`Explicit root user: "${rootUser.trim()}". Consider using a non-root user.`);
                    }
                    else {
                        info.push('Non-root USER instruction found ✓');
                    }
                }
                // ── 6. CMD / ENTRYPOINT check ─────────────────────────────────────────
                const cmdLines = lines.filter(l => /^\s*(CMD|ENTRYPOINT)\s/i.test(l));
                if (cmdLines.length === 0) {
                    warnings.push('No CMD or ENTRYPOINT found. Code Engine needs the container to start a long-running process.');
                }
                // ── 7. Healthcheck (informational) ────────────────────────────────────
                const hasHealthcheck = lines.some(l => /^\s*HEALTHCHECK\s/i.test(l));
                if (!hasHealthcheck) {
                    info.push('No HEALTHCHECK instruction. Code Engine uses TCP probe on the exposed port by default.');
                }
                const valid = errors.length === 0;
                const summary = valid
                    ? `Dockerfile is compatible with IBM Code Engine (${warnings.length} warning(s), ${info.length} info)`
                    : `Dockerfile has ${errors.length} error(s) that will prevent correct operation on Code Engine`;
                return { content: [{ type: 'text', text: JSON.stringify({ valid, summary, errors, warnings, info, dockerfile: dfPath }, null, 2) }], ...(valid ? {} : { isError: true }) };
            }
            case 'detect_container_runtime': {
                const { stdout: dockerVersion } = await execAsync('docker --version').catch(() => ({ stdout: '' }));
                const { stdout: podmanVersion } = await execAsync('podman --version').catch(() => ({ stdout: '' }));
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                docker: dockerVersion ? dockerVersion.trim() : null,
                                podman: podmanVersion ? podmanVersion.trim() : null,
                                available: dockerVersion ? 'docker' : podmanVersion ? 'podman' : 'none',
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'build_container_image': {
                const runtime = args.runtime || 'docker';
                const cmd = `${runtime} build -t ${args.image_name} -f ${args.dockerfile_path} ${args.context_path}`;
                const { stdout, stderr } = await execAsync(cmd);
                // Container runtimes write build progress to stderr — label it clearly
                const build_output = [stdout, stderr].filter(Boolean).join('\n').trim();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                command: cmd,
                                build_output,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'push_container_image': {
                const runtime = args.runtime || 'docker';
                const cmd = `${runtime} push ${args.image_name}`;
                const { stdout, stderr } = await execAsync(cmd);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                command: cmd,
                                output: stdout,
                                error: stderr
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'list_local_images': {
                const runtime = args.runtime || 'docker';
                const cmd = `${runtime} images --format "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}"`;
                const { stdout } = await execAsync(cmd);
                return {
                    content: [
                        {
                            type: 'text',
                            text: stdout,
                        },
                    ],
                };
            }
            case 'test_container_locally': {
                const runtime = args.runtime || 'docker';
                let cmd = `${runtime} run -d`;
                if (args.port_mapping) {
                    cmd += ` -p ${args.port_mapping}`;
                }
                if (args.env_vars) {
                    Object.entries(args.env_vars).forEach(([key, value]) => {
                        cmd += ` -e ${key}="${value}"`;
                    });
                }
                cmd += ` ${args.image_name}`;
                const { stdout } = await execAsync(cmd);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                container_id: stdout.trim(),
                                command: cmd,
                                message: 'Container started successfully'
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_container_logs': {
                const runtime = args.runtime || 'docker';
                const cmd = `${runtime} logs ${args.container_id}`;
                const { stdout } = await execAsync(cmd);
                return {
                    content: [
                        {
                            type: 'text',
                            text: stdout,
                        },
                    ],
                };
            }
            case 'stop_local_container': {
                const runtime = args.runtime || 'docker';
                const stopCmd = `${runtime} stop ${args.container_id}`;
                const rmCmd = `${runtime} rm ${args.container_id}`;
                await execAsync(stopCmd);
                await execAsync(rmCmd);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Container ${args.container_id} stopped and removed`
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'list_local_containers': {
                const runtime = args.runtime || 'docker';
                const allFlag = args.all ? '-a' : '';
                const cmd = `${runtime} ps ${allFlag} --format "{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`;
                const { stdout } = await execAsync(cmd);
                return {
                    content: [
                        {
                            type: 'text',
                            text: stdout,
                        },
                    ],
                };
            }
            case 'icr_list_namespaces': {
                const apiKey = getApiKey();
                const token = await getIAMToken(apiKey);
                const host = args.region || 'us.icr.io';
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                const accountId = payload?.account?.bss || '';
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
                const accountId = payload?.account?.bss || '';
                const params = { includeIBM: 'false' };
                if (args.namespace)
                    params.namespace = args.namespace;
                const response = await axios.get(`https://${host}/api/v1/images`, {
                    headers: { Authorization: `Bearer ${token}`, Account: accountId },
                    params,
                });
                const images = response.data.map((img) => ({
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
                const accountId = payload?.account?.bss || '';
                const response = await axios.delete(`https://${host}/api/v1/images/${encodeURIComponent(args.image)}`, { headers: { Authorization: `Bearer ${token}`, Account: accountId } });
                return { content: [{ type: 'text', text: JSON.stringify({ deleted: args.image, status: response.status }, null, 2) }] };
            }
            case 'ce_list_projects': {
                const apiKey = getApiKey();
                const token = await getIAMToken(apiKey);
                const regionsToCheck = args.region ? [args.region] : CE_REGIONS;
                const uniqueProjects = new Map();
                await Promise.allSettled(regionsToCheck.map(async (reg) => {
                    const response = await axios.get(`https://api.${reg}.codeengine.cloud.ibm.com/v2/projects`, { headers: { Authorization: `Bearer ${token}` } });
                    if (response.data.projects) {
                        response.data.projects.forEach((p) => {
                            if (!uniqueProjects.has(p.id))
                                uniqueProjects.set(p.id, { ...p, region: reg });
                        });
                    }
                }));
                const projects = Array.from(uniqueProjects.values());
                return { content: [{ type: 'text', text: JSON.stringify({ projects, total: projects.length }, null, 2) }] };
            }
            case 'ce_get_project': {
                const token = await getIAMToken(getApiKey());
                const region = await getProjectRegion(args.project_id, token);
                const response = await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${args.project_id}`, { headers: { Authorization: `Bearer ${token}` } });
                return { content: [{ type: 'text', text: JSON.stringify({ ...response.data, region }, null, 2) }] };
            }
            case 'ce_create_project': {
                const token = await getIAMToken(getApiKey());
                const region = args.region;
                const body = { name: args.name };
                if (args.resource_group_id)
                    body.resource_group_id = args.resource_group_id;
                const response = await axios.post(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects`, body, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_project': {
                const token = await getIAMToken(getApiKey());
                const region = await getProjectRegion(args.project_id, token);
                await axios.delete(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${args.project_id}`, { headers: { Authorization: `Bearer ${token}` } });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Project ${args.project_id} deleted` }, null, 2) }] };
            }
            case 'ce_list_applications': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/apps`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ applications: response.data.apps || [], total: response.data.apps?.length || 0 }, null, 2) }] };
            }
            case 'ce_get_application': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/apps/${args.app_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_create_application': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = {
                    name: args.name,
                    image_reference: args.image,
                    image_port: args.port ?? 8080,
                    scale_min_instances: args.scale_min_instances ?? 0,
                    scale_max_instances: args.scale_max_instances ?? 10,
                    scale_cpu_limit: args.scale_cpu_limit ?? '1',
                    scale_memory_limit: args.scale_memory_limit ?? '4G',
                };
                if (args.image_secret)
                    body.image_secret = args.image_secret;
                if (args.env_vars) {
                    body.run_env_variables = Object.entries(args.env_vars).map(([name, value]) => ({
                        type: 'literal', name, value,
                    }));
                }
                const response = await axios.post(`${base}/apps`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_update_application': {
                const token = await getIAMToken(getApiKey());
                const { base } = await ceApi(args.project_id, token);
                // CE PATCH requires If-Match with the current entity_tag
                const current = await axios.get(`${base}/apps/${args.app_name}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const entityTag = current.data.entity_tag ?? current.data.resource_version ?? '*';
                const patch = {};
                if (args.image)
                    patch.image_reference = args.image;
                if (args.image_secret)
                    patch.image_secret = args.image_secret;
                if (args.scale_min_instances !== undefined)
                    patch.scale_min_instances = args.scale_min_instances;
                if (args.scale_max_instances !== undefined)
                    patch.scale_max_instances = args.scale_max_instances;
                if (args.scale_cpu_limit)
                    patch.scale_cpu_limit = args.scale_cpu_limit;
                if (args.scale_memory_limit)
                    patch.scale_memory_limit = args.scale_memory_limit;
                const response = await axios.patch(`${base}/apps/${args.app_name}`, patch, {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/merge-patch+json', 'If-Match': entityTag },
                });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_application': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/apps/${args.app_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Application ${args.app_name} deleted` }, null, 2) }] };
            }
            case 'ce_list_app_instances': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/apps/${args.app_name}/instances`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ instances: response.data.instances || [], total: response.data.instances?.length || 0 }, null, 2) }] };
            }
            case 'ce_get_app_instance': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/apps/${args.app_name}/instances`, { headers });
                const instances = response.data.instances || [];
                const instance = instances.find((i) => i.name === args.instance_name);
                if (!instance) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: `Instance '${args.instance_name}' not found`, available: instances.map((i) => i.name) }, null, 2) }] };
                }
                return { content: [{ type: 'text', text: JSON.stringify(instance, null, 2) }] };
            }
            case 'ce_get_app_logs': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                try {
                    const response = await axios.get(`${base}/apps/${args.app_name}/instances/${args.instance_name}/logs`, { headers });
                    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
                }
                catch (err) {
                    if (err.response?.status === 403) {
                        return { content: [{ type: 'text', text: JSON.stringify({
                                        note: 'App instance logs are not accessible via the Code Engine REST API v2. ' +
                                            'Configure IBM Log Analysis (IBM Cloud Logging) for your project to retrieve logs via the IBM Cloud Logs API.',
                                        docs: 'https://cloud.ibm.com/docs/codeengine?topic=codeengine-view-logs',
                                        status: 403,
                                    }, null, 2) }] };
                    }
                    throw err;
                }
            }
            case 'ce_list_builds': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/builds`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ builds: response.data.builds || [], total: response.data.builds?.length || 0 }, null, 2) }] };
            }
            case 'ce_get_build': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/builds/${args.build_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_build': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/builds/${args.build_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Build ${args.build_name} deleted` }, null, 2) }] };
            }
            case 'ce_create_build': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = {
                    name: args.name,
                    output_image: args.output_image,
                    output_secret: args.output_secret,
                    source_type: args.source_type ?? 'local',
                    strategy_type: args.strategy_type ?? 'dockerfile',
                    strategy_spec_file: args.strategy_spec_file ?? 'Dockerfile',
                    strategy_size: args.strategy_size ?? 'medium',
                };
                const response = await axios.post(`${base}/builds`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_list_build_runs': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/build_runs`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ build_runs: response.data.build_runs || [], total: response.data.build_runs?.length || 0 }, null, 2) }] };
            }
            case 'ce_create_build_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = { build_name: args.build_name };
                if (args.name)
                    body.name = args.name;
                const response = await axios.post(`${base}/build_runs`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_get_build_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/build_runs/${args.build_run_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_build_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/build_runs/${args.build_run_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Build run ${args.build_run_name} deleted` }, null, 2) }] };
            }
            case 'ce_list_jobs': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/jobs`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ jobs: response.data.jobs || [], total: response.data.jobs?.length || 0 }, null, 2) }] };
            }
            case 'ce_create_job': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = { name: args.name, image_reference: args.image, run_mode: 'task' };
                if (args.scale_array_spec)
                    body.scale_array_spec = args.scale_array_spec;
                if (args.scale_cpu_limit)
                    body.scale_cpu_limit = args.scale_cpu_limit;
                if (args.scale_memory_limit)
                    body.scale_memory_limit = args.scale_memory_limit;
                if (args.env_vars) {
                    body.run_env_variables = Object.entries(args.env_vars).map(([name, value]) => ({
                        type: 'literal', name, value,
                    }));
                }
                const response = await axios.post(`${base}/jobs`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_create_job_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = { job_name: args.job_name };
                if (args.name)
                    body.name = args.name;
                const response = await axios.post(`${base}/job_runs`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_get_job': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/jobs/${args.job_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_job': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/jobs/${args.job_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Job ${args.job_name} deleted` }, null, 2) }] };
            }
            case 'ce_list_job_runs': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const params = {};
                if (args.job_name)
                    params.job_name = args.job_name;
                if (args.limit)
                    params.limit = args.limit;
                if (args.start)
                    params.start = args.start;
                const response = await axios.get(`${base}/job_runs`, { headers, params });
                return { content: [{ type: 'text', text: JSON.stringify({ job_runs: response.data.job_runs || [], total: response.data.job_runs?.length || 0 }, null, 2) }] };
            }
            case 'ce_get_job_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/job_runs/${args.job_run_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_job_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/job_runs/${args.job_run_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Job run ${args.job_run_name} deleted` }, null, 2) }] };
            }
            case 'ce_list_secrets': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/secrets`, { headers });
                // Omit secret data values from the listing for security
                const secrets = (response.data.secrets || []).map((s) => ({
                    name: s.name, format: s.format, created_at: s.created_at,
                    keys: s.data ? Object.keys(s.data) : [],
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ secrets, total: secrets.length }, null, 2) }] };
            }
            case 'ce_create_secret': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = { name: args.name, format: args.format, data: args.data };
                const response = await axios.post(`${base}/secrets`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ name: response.data.name, format: response.data.format, created_at: response.data.created_at }, null, 2) }] };
            }
            case 'ce_get_secret': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/secrets/${args.secret_name}`, { headers });
                // Return metadata only — omit secret payload for security
                const s = response.data;
                return { content: [{ type: 'text', text: JSON.stringify({ name: s.name, format: s.format, created_at: s.created_at, keys: s.data ? Object.keys(s.data) : [] }, null, 2) }] };
            }
            case 'ce_delete_secret': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/secrets/${args.secret_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Secret ${args.secret_name} deleted` }, null, 2) }] };
            }
            case 'ce_list_config_maps': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/config_maps`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ config_maps: response.data.config_maps || [], total: response.data.config_maps?.length || 0 }, null, 2) }] };
            }
            case 'ce_create_config_map': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = { name: args.name, data: args.data };
                const response = await axios.post(`${base}/config_maps`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_get_config_map': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/config_maps/${args.config_map_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_config_map': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/config_maps/${args.config_map_name}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `ConfigMap ${args.config_map_name} deleted` }, null, 2) }] };
            }
            case 'ce_list_domain_mappings': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/domain_mappings`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_get_domain_mapping': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const response = await axios.get(`${base}/domain_mappings/${encodeURIComponent(args.domain_name)}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_create_domain_mapping': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = {
                    name: args.domain_name,
                    component: { resource_type: 'app_v2', name: args.app_name },
                    tls_secret: args.tls_secret,
                };
                const response = await axios.post(`${base}/domain_mappings`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_create_tls_secret_from_pem': {
                const fs = await import('fs');
                const os = await import('os');
                const resolvePath = (p) => p.replace(/^~/, os.homedir());
                const certPem = fs.readFileSync(resolvePath(args.cert_pem_path), 'utf8');
                const keyPem = fs.readFileSync(resolvePath(args.key_pem_path), 'utf8');
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const body = { name: args.secret_name, format: 'tls', data: { tls_cert: certPem, tls_key: keyPem } };
                const response = await axios.post(`${base}/secrets`, body, { headers });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'ce_delete_domain_mapping': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                await axios.delete(`${base}/domain_mappings/${encodeURIComponent(args.domain_name)}`, { headers });
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Domain mapping ${args.domain_name} deleted` }, null, 2) }] };
            }
            case 'ce_update_secret': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const current = await axios.get(`${base}/secrets/${args.secret_name}`, { headers });
                const etag = current.data.entity_tag;
                const patchHeaders = { ...headers, 'If-Match': etag };
                const body = { data: args.data };
                if (args.format)
                    body.format = args.format;
                const response = await axios.patch(`${base}/secrets/${args.secret_name}`, body, { headers: patchHeaders });
                return { content: [{ type: 'text', text: JSON.stringify({ name: response.data.name, format: response.data.format, updated_at: response.data.updated_at, message: 'Secret updated successfully' }, null, 2) }] };
            }
            case 'ce_renew_tls_secret_from_pem': {
                const fs = await import('fs');
                const os = await import('os');
                const resolvePath = (p) => p.replace(/^~/, os.homedir());
                const certPem = fs.readFileSync(resolvePath(args.cert_pem_path), 'utf8');
                const keyPem = fs.readFileSync(resolvePath(args.key_pem_path), 'utf8');
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const current = await axios.get(`${base}/secrets/${args.secret_name}`, { headers });
                const etag = current.data.entity_tag;
                const patchHeaders = { ...headers, 'If-Match': etag };
                const response = await axios.patch(`${base}/secrets/${args.secret_name}`, { data: { tls_cert: certPem, tls_key: keyPem } }, { headers: patchHeaders });
                return { content: [{ type: 'text', text: JSON.stringify({ name: response.data.name, format: response.data.format, updated_at: response.data.updated_at, message: 'TLS secret renewed — no domain mapping change needed' }, null, 2) }] };
            }
            case 'ce_wait_for_app_ready': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const maxWait = (args.timeout_seconds || 120) * 1000;
                const interval = 5000;
                const start = Date.now();
                let last = {};
                const pollHistory = [];
                while (Date.now() - start < maxWait) {
                    const response = await axios.get(`${base}/apps/${args.app_name}`, { headers });
                    last = response.data;
                    const snap = {
                        elapsed_s: Math.round((Date.now() - start) / 1000),
                        status: last.status,
                        reason: last.status_details?.reason,
                        revision: last.status_details?.latest_created_revision,
                    };
                    pollHistory.push(snap);
                    if (last.status === 'ready') {
                        return { content: [{ type: 'text', text: JSON.stringify({
                                        status: 'ready',
                                        elapsed_seconds: snap.elapsed_s,
                                        endpoint: last.endpoint,
                                        latest_ready_revision: last.status_details?.latest_ready_revision,
                                        poll_history: pollHistory,
                                    }, null, 2) }] };
                    }
                    if (last.status === 'failed') {
                        return { content: [{ type: 'text', text: JSON.stringify({
                                        status: 'failed',
                                        elapsed_seconds: snap.elapsed_s,
                                        reason: last.status_details?.reason,
                                        status_details: last.status_details,
                                        poll_history: pollHistory,
                                    }, null, 2) }], isError: true };
                    }
                    await new Promise(r => setTimeout(r, interval));
                }
                return { content: [{ type: 'text', text: JSON.stringify({
                                status: 'timeout',
                                elapsed_seconds: Math.round(maxWait / 1000),
                                last_status: last.status,
                                reason: last.status_details?.reason,
                                poll_history: pollHistory,
                            }, null, 2) }], isError: true };
            }
            case 'ce_wait_for_build_run': {
                const token = await getIAMToken(getApiKey());
                const { base, headers } = await ceApi(args.project_id, token);
                const maxWait = (args.timeout_seconds || 600) * 1000;
                const interval = 10000;
                const start = Date.now();
                let last = {};
                const pollHistory = [];
                while (Date.now() - start < maxWait) {
                    const response = await axios.get(`${base}/build_runs/${args.build_run_name}`, { headers });
                    last = response.data;
                    const snap = {
                        elapsed_s: Math.round((Date.now() - start) / 1000),
                        status: last.status,
                        reason: last.status_details?.reason,
                    };
                    // only add to history when status changes
                    if (pollHistory.length === 0 || pollHistory[pollHistory.length - 1].status !== snap.status) {
                        pollHistory.push(snap);
                    }
                    if (last.status === 'succeeded') {
                        return { content: [{ type: 'text', text: JSON.stringify({
                                        status: 'succeeded',
                                        elapsed_seconds: snap.elapsed_s,
                                        output_image: last.output_image,
                                        build_run_name: last.name,
                                        poll_history: pollHistory,
                                    }, null, 2) }] };
                    }
                    if (last.status === 'failed') {
                        return { content: [{ type: 'text', text: JSON.stringify({
                                        status: 'failed',
                                        elapsed_seconds: snap.elapsed_s,
                                        reason: last.status_details?.reason,
                                        status_details: last.status_details,
                                        poll_history: pollHistory,
                                    }, null, 2) }], isError: true };
                    }
                    await new Promise(r => setTimeout(r, interval));
                }
                return { content: [{ type: 'text', text: JSON.stringify({
                                status: 'timeout',
                                elapsed_seconds: Math.round(maxWait / 1000),
                                last_status: last.status,
                                reason: last.status_details?.reason,
                                poll_history: pollHistory,
                            }, null, 2) }], isError: true };
            }
            case 'icr_create_namespace': {
                const apiKey = getApiKey();
                const token = await getIAMToken(apiKey);
                const host = args.region || 'us.icr.io';
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                const accountId = payload?.account?.bss || '';
                const response = await axios.put(`https://${host}/api/v1/namespaces/${encodeURIComponent(args.namespace)}`, {}, { headers: { Authorization: `Bearer ${token}`, Account: accountId, 'Content-Type': 'application/json' } });
                return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
            }
            case 'iam_get_token_info': {
                const token = await getIAMToken(getApiKey());
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                const expMs = payload.exp * 1000;
                const nowMs = Date.now();
                const info = {
                    account_id: payload?.account?.bss || payload?.account,
                    iam_id: payload?.iam_id,
                    sub: payload?.sub,
                    email: payload?.email,
                    expires_at: new Date(expMs).toISOString(),
                    expires_in_seconds: Math.floor((expMs - nowMs) / 1000),
                    valid: expMs > nowMs,
                    scopes: payload?.scope,
                };
                return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
            }
            // ─── Procedures ──────────────────────────────────────────────────────────
            case 'proc_build_push_deploy': {
                const steps = [];
                // 0) validate Dockerfile before doing anything else
                const contextPathRaw = args.context_path;
                const fsM = await import('fs');
                const pathM = await import('path');
                const osM = await import('os');
                const resolveProcPath = (p) => p.startsWith('~') ? p.replace(/^~/, osM.homedir()) : p;
                const resolvedContext = resolveProcPath(contextPathRaw);
                const dockerfilePath = pathM.join(resolvedContext, 'Dockerfile');
                if (fsM.existsSync(dockerfilePath)) {
                    const dfContent = fsM.readFileSync(dockerfilePath, 'utf8');
                    const dfLines = dfContent.split('\n');
                    const expectedPort = args.port || 8080;
                    const valErrors = [];
                    const valWarnings = [];
                    // Architecture check
                    const fromPlatformLines = dfLines.filter(l => /^\s*FROM\s.*--platform/i.test(l));
                    const wrongArch = fromPlatformLines.filter(l => !/--platform\s+linux\/amd64/i.test(l));
                    if (wrongArch.length > 0)
                        valErrors.push(`Architecture: FROM --platform must be linux/amd64. Found: ${wrongArch.map(l => l.trim()).join(' | ')}`);
                    // Port check
                    const exposedPorts = dfLines.filter(l => /^\s*EXPOSE\s/i.test(l))
                        .flatMap(l => l.replace(/^\s*EXPOSE\s+/i, '').trim().split(/\s+/).map(Number).filter(Boolean));
                    if (exposedPorts.length > 0 && !exposedPorts.includes(expectedPort)) {
                        valErrors.push(`Port mismatch: EXPOSE declares [${exposedPorts.join(', ')}] but app port is ${expectedPort}.`);
                    }
                    if (exposedPorts.includes(80))
                        valErrors.push('Port 80 is not allowed in Code Engine. Use port 8080.');
                    // nginx sed pattern check
                    dfLines.filter(l => /sed\s+-i/.test(l) && /listen/.test(l)).forEach(sl => {
                        if (/listen\s{2,}80;/.test(sl)) {
                            valWarnings.push(`Fragile nginx sed pattern: "${sl.trim()}" — use 's/listen[[:space:]]*80;/listen 8080;/g' to handle variable whitespace in nginx:alpine`);
                        }
                    });
                    if (valErrors.length > 0) {
                        return { content: [{ type: 'text', text: JSON.stringify({
                                        status: 'aborted',
                                        reason: 'Dockerfile validation failed — fix errors before building',
                                        dockerfile_errors: valErrors,
                                        dockerfile_warnings: valWarnings,
                                        steps,
                                    }, null, 2) }], isError: true };
                    }
                    const validLine = `[0/5] Dockerfile validated ✓${valWarnings.length ? ` (${valWarnings.length} warning(s): ${valWarnings.join('; ')})` : ''}`;
                    steps.push(validLine);
                }
                else {
                    steps.push(`[0/5] No Dockerfile found at ${dockerfilePath} — skipping pre-flight validation`);
                }
                // 1) detect runtime
                let runtime = 'podman';
                try {
                    await execAsync('podman --version');
                }
                catch {
                    runtime = 'docker';
                }
                steps.push(`[1/5] Using container runtime: ${runtime}`);
                // 2) resolve project
                const token1 = await getIAMToken(getApiKey());
                const projectId1 = await resolveProjectId(args.project_id_or_name, token1);
                steps.push(`[2/5] Resolved project: ${projectId1}`);
                // 3) build the image name from namespace + app + tag
                const icrHost = args.icr_host || 'us.icr.io';
                const imageTag = args.image_tag || 'latest';
                const imageName = `${icrHost}/${args.icr_namespace}/${args.app_name}:${imageTag}`;
                const contextPath = contextPathRaw;
                const buildCmd = `${runtime} build --platform linux/amd64 -t ${imageName} ${contextPath}`;
                const { stdout: buildStdout, stderr: buildStderr } = await execAsync(buildCmd);
                const buildOutput = [buildStdout, buildStderr].filter(Boolean).join('\n').trim();
                // show last 20 lines of build output so it's not overwhelming
                const buildLines = buildOutput.split('\n');
                const buildSummary = buildLines.length > 20 ? `...${buildLines.slice(-20).join('\n')}` : buildOutput;
                steps.push(`[3/5] Built ${imageName} for linux/amd64:\n${buildSummary}`);
                // 4) push
                const pushCmd = `${runtime} push ${imageName}`;
                const { stdout: pushStdout, stderr: pushStderr } = await execAsync(pushCmd);
                const pushOutput = [pushStdout, pushStderr].filter(Boolean).join('\n').trim();
                steps.push(`[4/5] Pushed to ${icrHost}:\n${pushOutput}`);
                // 5) create or update CE app
                const { base: base1, headers: headers1 } = await ceApi(projectId1, token1);
                const appPayload1 = {
                    image_reference: imageName,
                    image_secret: args.image_secret,
                    scale_initial_instances: 1,
                    scale_min_instances: args.scale_min_instances ?? 0,
                    scale_max_instances: args.scale_max_instances ?? 10,
                    image_port: args.port ?? 8080,
                };
                if (args.env_vars) {
                    appPayload1.run_env_variables = Object.entries(args.env_vars).map(([k, v]) => ({ type: 'literal', name: k, value: v }));
                }
                let appEndpoint1 = '';
                try {
                    const existing = await axios.get(`${base1}/apps/${args.app_name}`, { headers: headers1 });
                    const patchHeaders = { ...headers1, 'If-Match': existing.data.entity_tag };
                    const updated = await axios.patch(`${base1}/apps/${args.app_name}`, appPayload1, { headers: patchHeaders });
                    appEndpoint1 = updated.data.endpoint || '';
                    steps.push(`[5/5] App updated (revision ${updated.data.status_details?.latest_created_revision})`);
                }
                catch {
                    const created = await axios.post(`${base1}/apps`, { name: args.app_name, ...appPayload1 }, { headers: headers1 });
                    appEndpoint1 = created.data.endpoint || '';
                    steps.push(`[5/5] App created`);
                }
                // wait for ready
                const maxWait1 = (args.timeout_seconds || 180) * 1000;
                const start1 = Date.now();
                let last1 = {};
                const pollHistory1 = [];
                while (Date.now() - start1 < maxWait1) {
                    const res = await axios.get(`${base1}/apps/${args.app_name}`, { headers: headers1 });
                    last1 = res.data;
                    const snap1 = { elapsed_s: Math.round((Date.now() - start1) / 1000), status: last1.status, reason: last1.status_details?.reason, revision: last1.status_details?.latest_created_revision };
                    if (pollHistory1.length === 0 || pollHistory1[pollHistory1.length - 1].status !== snap1.status)
                        pollHistory1.push(snap1);
                    if (last1.status === 'ready')
                        break;
                    if (last1.status === 'failed') {
                        return { content: [{ type: 'text', text: JSON.stringify({ steps, status: 'failed', reason: last1.status_details?.reason, status_details: last1.status_details, poll_history: pollHistory1 }, null, 2) }], isError: true };
                    }
                    await new Promise(r => setTimeout(r, 5000));
                }
                return { content: [{ type: 'text', text: JSON.stringify({
                                status: last1.status,
                                endpoint: last1.endpoint || appEndpoint1,
                                image: imageName,
                                latest_ready_revision: last1.status_details?.latest_ready_revision,
                                elapsed_seconds: Math.round((Date.now() - start1) / 1000),
                                steps,
                                poll_history: pollHistory1,
                            }, null, 2) }] };
            }
            case 'proc_setup_custom_domain': {
                const fs = await import('fs');
                const os = await import('os');
                const resolvePath = (p) => p.replace(/^~/, os.homedir());
                const certPem = fs.readFileSync(resolvePath(args.cert_pem_path), 'utf8');
                const keyPem = fs.readFileSync(resolvePath(args.key_pem_path), 'utf8');
                const token2 = await getIAMToken(getApiKey());
                const projectId2 = await resolveProjectId(args.project_id_or_name, token2);
                const { base: base2, headers: headers2 } = await ceApi(projectId2, token2);
                const secretBody = { name: args.tls_secret_name, format: 'tls', data: { tls_cert: certPem, tls_key: keyPem } };
                const secretRes = await axios.post(`${base2}/secrets`, secretBody, { headers: headers2 });
                const mappingBody = {
                    name: args.domain_name,
                    component: { resource_type: 'app_v2', name: args.app_name },
                    tls_secret: args.tls_secret_name,
                };
                const mappingRes = await axios.post(`${base2}/domain_mappings`, mappingBody, { headers: headers2 });
                return { content: [{ type: 'text', text: JSON.stringify({
                                tls_secret: { name: secretRes.data.name, created_at: secretRes.data.created_at },
                                domain_mapping: { name: mappingRes.data.name, status: mappingRes.data.status, cname_target: mappingRes.data.cname_target },
                                next_step: `In your DNS provider, add a CNAME record: ${args.domain_name} → ${mappingRes.data.cname_target}`,
                            }, null, 2) }] };
            }
            case 'proc_build_run_and_deploy': {
                const token3 = await getIAMToken(getApiKey());
                const projectId3 = await resolveProjectId(args.project_id_or_name, token3);
                const { base: base3, headers: headers3 } = await ceApi(projectId3, token3);
                const steps3 = [];
                steps3.push(`[1/4] Resolved project: ${projectId3}`);
                // get build config to find output image
                const buildConfig = await axios.get(`${base3}/builds/${args.build_name}`, { headers: headers3 });
                const outputImage = buildConfig.data.output_image;
                steps3.push(`[2/4] Build config found. Output image: ${outputImage}`);
                // start build run
                const buildRunRes = await axios.post(`${base3}/build_runs`, { build_name: args.build_name }, { headers: headers3 });
                const buildRunName = buildRunRes.data.name;
                steps3.push(`[3/4] Build run started: ${buildRunName}`);
                // wait for build run
                const buildMaxWait = (args.build_timeout_seconds || 600) * 1000;
                const buildStart = Date.now();
                let buildLast = {};
                const buildPollHistory = [];
                while (Date.now() - buildStart < buildMaxWait) {
                    const res = await axios.get(`${base3}/build_runs/${buildRunName}`, { headers: headers3 });
                    buildLast = res.data;
                    const bsnap = { elapsed_s: Math.round((Date.now() - buildStart) / 1000), status: buildLast.status, reason: buildLast.status_details?.reason };
                    if (buildPollHistory.length === 0 || buildPollHistory[buildPollHistory.length - 1].status !== bsnap.status)
                        buildPollHistory.push(bsnap);
                    if (buildLast.status === 'succeeded')
                        break;
                    if (buildLast.status === 'failed') {
                        return { content: [{ type: 'text', text: JSON.stringify({ steps: steps3, build_status: 'failed', reason: buildLast.status_details?.reason, status_details: buildLast.status_details, build_poll_history: buildPollHistory }, null, 2) }], isError: true };
                    }
                    await new Promise(r => setTimeout(r, 10000));
                }
                if (buildLast.status !== 'succeeded') {
                    return { content: [{ type: 'text', text: JSON.stringify({ steps: steps3, build_status: 'timeout', last_status: buildLast.status, build_poll_history: buildPollHistory }, null, 2) }], isError: true };
                }
                steps3.push(`Build done in ${Math.round((Date.now() - buildStart) / 1000)}s (history: ${buildPollHistory.map(h => `${h.elapsed_s}s→${h.status}`).join(', ')})`);
                // create or update app
                const appPayload3 = {
                    image_reference: outputImage,
                    image_secret: args.image_secret,
                    image_port: args.port ?? 8080,
                };
                try {
                    const existing = await axios.get(`${base3}/apps/${args.app_name}`, { headers: headers3 });
                    const patchHeaders = { ...headers3, 'If-Match': existing.data.entity_tag };
                    const updated = await axios.patch(`${base3}/apps/${args.app_name}`, appPayload3, { headers: patchHeaders });
                    steps3.push(`[4/4] App updated (revision ${updated.data.status_details?.latest_created_revision})`);
                }
                catch {
                    await axios.post(`${base3}/apps`, { name: args.app_name, ...appPayload3 }, { headers: headers3 });
                    steps3.push(`[4/4] App created`);
                }
                // wait for app ready
                const appMaxWait = (args.deploy_timeout_seconds || 180) * 1000;
                const appStart = Date.now();
                let appLast = {};
                const appPollHistory = [];
                while (Date.now() - appStart < appMaxWait) {
                    const res = await axios.get(`${base3}/apps/${args.app_name}`, { headers: headers3 });
                    appLast = res.data;
                    const asnap = { elapsed_s: Math.round((Date.now() - appStart) / 1000), status: appLast.status, reason: appLast.status_details?.reason, revision: appLast.status_details?.latest_created_revision };
                    if (appPollHistory.length === 0 || appPollHistory[appPollHistory.length - 1].status !== asnap.status)
                        appPollHistory.push(asnap);
                    if (appLast.status === 'ready')
                        break;
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
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: error.message,
                        stderr: error.stderr,
                        stdout: error.stdout,
                        response_data: error.response?.data,
                        status: error.response?.status,
                    }, null, 2),
                },
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
//# sourceMappingURL=index.js.map