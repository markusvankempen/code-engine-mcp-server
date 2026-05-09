#!/usr/bin/env node
/**
 * Context Discovery Module for IBM Code Engine
 * 
 * This module discovers and caches deployment context including:
 * - Available Code Engine projects
 * - Container Registry namespaces
 * - Existing applications
 * - Resource groups
 * 
 * Uses IBM Cloud REST API directly (no CLI required).
 * 
 * Author: Markus van Kempen | markus.van.kempen@gmail.com
 * Research | Floor 7½ 🏢🤏
 * "No bug too small, no syntax too weird."
 */

import * as https from 'https';

export interface Project {
  id: string;
  name: string;
  region: string;
  resource_group_id: string;
  created_at: string;
  status: string;
}

export interface Application {
  name: string;
  project_id: string;
  project_name: string;
  status: string;
  url?: string;
  image?: string;
}

export interface RegistryNamespace {
  name: string;
  resource_group_id: string;
  created_date: string;
  updated_date: string;
}

export interface DeploymentContext {
  projects: Project[];
  applications: Application[];
  registryNamespaces: RegistryNamespace[];
  timestamp: string;
}

/**
 * Get IAM access token using API key
 */
export async function getIAMToken(apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${apiKey}`;
    
    const options = {
      hostname: 'iam.cloud.ibm.com',
      path: '/identity/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            resolve(response.access_token);
          } else {
            reject(new Error('No access token in response'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * List all Code Engine projects
 */
export async function listProjects(token: string, region: string = 'us-south'): Promise<Project[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `api.${region}.codeengine.cloud.ibm.com`,
      path: `/v2/projects`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response.projects || []);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * List applications in a specific project
 */
export async function listApplicationsInProject(
  token: string,
  region: string,
  projectId: string
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `api.${region}.codeengine.cloud.ibm.com`,
      path: `/v2/projects/${projectId}/apps`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response.apps || []);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * List all applications across all projects
 */
export async function listAllApplications(token: string, region: string = 'us-south'): Promise<Application[]> {
  const projects = await listProjects(token, region);
  const allApps: Application[] = [];

  for (const project of projects) {
    try {
      const apps = await listApplicationsInProject(token, region, project.id);
      for (const app of apps) {
        allApps.push({
          name: app.name,
          project_id: project.id,
          project_name: project.name,
          status: app.status?.state || 'unknown',
          url: app.status?.url,
          image: app.spec?.image_reference
        });
      }
    } catch (error) {
      console.error(`Failed to list apps in project ${project.name}:`, error);
    }
  }

  return allApps;
}

/**
 * List Container Registry namespaces
 * Note: This requires IBM Cloud CLI as there's no direct REST API for registry namespaces
 */
export async function listRegistryNamespaces(token: string): Promise<RegistryNamespace[]> {
  // For now, return empty array as registry API requires CLI
  // In production, you would use: ibmcloud cr namespace-list
  console.warn('Registry namespace listing requires IBM Cloud CLI');
  return [];
}

/**
 * Discover complete deployment context
 */
export async function discoverContext(apiKey: string, region: string = 'us-south'): Promise<DeploymentContext> {
  console.log('🔍 Discovering deployment context...\n');

  // Get IAM token
  console.log('🔐 Authenticating with IBM Cloud...');
  const token = await getIAMToken(apiKey);
  console.log('✅ Authentication successful\n');

  // Discover projects
  console.log('📦 Discovering Code Engine projects...');
  const projects = await listProjects(token, region);
  console.log(`✅ Found ${projects.length} project(s)\n`);

  // Discover applications
  console.log('🚀 Discovering applications...');
  const applications = await listAllApplications(token, region);
  console.log(`✅ Found ${applications.length} application(s)\n`);

  // Discover registry namespaces
  console.log('📦 Discovering registry namespaces...');
  const registryNamespaces = await listRegistryNamespaces(token);
  console.log(`✅ Found ${registryNamespaces.length} namespace(s)\n`);

  return {
    projects,
    applications,
    registryNamespaces,
    timestamp: new Date().toISOString()
  };
}

/**
 * Format context for display
 */
export function formatContext(context: DeploymentContext): string {
  let output = '# IBM Cloud Deployment Context\n\n';
  output += `**Discovered:** ${new Date(context.timestamp).toLocaleString()}\n\n`;

  // Projects
  output += '## Code Engine Projects\n\n';
  if (context.projects.length === 0) {
    output += '*No projects found*\n\n';
  } else {
    context.projects.forEach((project, index) => {
      output += `${index + 1}. **${project.name}**\n`;
      output += `   - ID: \`${project.id}\`\n`;
      output += `   - Region: ${project.region}\n`;
      output += `   - Status: ${project.status}\n`;
      output += `   - Created: ${new Date(project.created_at).toLocaleDateString()}\n\n`;
    });
  }

  // Applications
  output += '## Deployed Applications\n\n';
  if (context.applications.length === 0) {
    output += '*No applications found*\n\n';
  } else {
    const appsByProject = context.applications.reduce((acc, app) => {
      if (!acc[app.project_name]) {
        acc[app.project_name] = [];
      }
      acc[app.project_name].push(app);
      return acc;
    }, {} as Record<string, Application[]>);

    Object.entries(appsByProject).forEach(([projectName, apps]) => {
      output += `### Project: ${projectName}\n\n`;
      apps.forEach((app, index) => {
        output += `${index + 1}. **${app.name}**\n`;
        output += `   - Status: ${app.status}\n`;
        if (app.url) output += `   - URL: ${app.url}\n`;
        if (app.image) output += `   - Image: \`${app.image}\`\n`;
        output += '\n';
      });
    });
  }

  // Registry Namespaces
  output += '## Container Registry Namespaces\n\n';
  if (context.registryNamespaces.length === 0) {
    output += '*No namespaces found (requires IBM Cloud CLI)*\n\n';
  } else {
    context.registryNamespaces.forEach((ns, index) => {
      output += `${index + 1}. **${ns.name}**\n`;
      output += `   - Created: ${new Date(ns.created_date).toLocaleDateString()}\n`;
      output += `   - Updated: ${new Date(ns.updated_date).toLocaleDateString()}\n\n`;
    });
  }

  return output;
}

/**
 * Interactive project selection
 */
export function selectProject(projects: Project[]): void {
  console.log('\n📋 Available Projects:\n');
  projects.forEach((project, index) => {
    console.log(`${index + 1}. ${project.name}`);
    console.log(`   Region: ${project.region} | Status: ${project.status}`);
    console.log(`   ID: ${project.id}\n`);
  });
}

/**
 * Find project by name
 */
export function findProjectByName(projects: Project[], name: string): Project | undefined {
  return projects.find(p => 
    p.name.toLowerCase() === name.toLowerCase() ||
    p.id === name
  );
}

/**
 * Check if application exists in any project
 */
export function findApplication(applications: Application[], appName: string): Application | undefined {
  return applications.find(app => app.name === appName);
}

// CLI interface
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  const apiKey = process.env.IBMCLOUD_API_KEY;
  const region = process.env.IBM_CLOUD_REGION || 'us-south';

  if (!apiKey) {
    console.error('❌ Error: IBMCLOUD_API_KEY environment variable not set');
    process.exit(1);
  }

  discoverContext(apiKey, region)
    .then(context => {
      console.log(formatContext(context));
      
      // Save to file
      writeFileSync(
        'deployment-context.json',
        JSON.stringify(context, null, 2)
      );
      console.log('💾 Context saved to deployment-context.json');
    })
    .catch(error => {
      console.error('❌ Discovery failed:', error.message);
      process.exit(1);
    });
}

// Made by MVK
