#!/usr/bin/env node
/**
 * Enhanced Code Engine Deployment Tool with Context Discovery
 *
 * This tool automatically discovers available projects and namespaces,
 * then prompts the user to select deployment targets.
 *
 * Uses IBM Cloud REST API directly (no CLI required).
 *
 * Author: Markus van Kempen | markus.van.kempen@gmail.com
 * Research | Floor 7½ 🏢🤏
 * "No bug too small, no syntax too weird."
 */
import { config } from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import * as readline from 'readline';
import { resolve } from 'path';
// Load environment variables from parent directory
config({ path: resolve(process.cwd(), '../.env') });
import { discoverContext, findProjectByName } from './context-discovery.js';
const execAsync = promisify(exec);
/**
 * Prompt user for input
 */
async function promptUser(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}
/**
 * Interactive project selection
 */
async function selectProjectInteractive(projects) {
    console.log('\n📋 Available Code Engine Projects:\n');
    projects.forEach((project, index) => {
        console.log(`${index + 1}. ${project.name}`);
        console.log(`   Region: ${project.region} | Status: ${project.status}`);
        console.log(`   ID: ${project.id}\n`);
    });
    const answer = await promptUser('Select project number (or enter project name): ');
    // Check if it's a number
    const num = parseInt(answer);
    if (!isNaN(num) && num > 0 && num <= projects.length) {
        return projects[num - 1];
    }
    // Try to find by name
    const project = findProjectByName(projects, answer);
    if (project) {
        return project;
    }
    throw new Error(`Invalid selection: ${answer}`);
}
/**
 * Get IAM token
 */
async function getIAMToken(apiKey) {
    const response = await axios.post('https://iam.cloud.ibm.com/identity/token', `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${apiKey}`, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    return response.data.access_token;
}
/**
 * Detect container runtime (Docker or Podman)
 */
async function detectRuntime() {
    try {
        await execAsync('docker --version');
        return 'docker';
    }
    catch {
        try {
            await execAsync('podman --version');
            return 'podman';
        }
        catch {
            throw new Error('Neither Docker nor Podman found. Please install one.');
        }
    }
}
/**
 * Build container image
 */
async function buildImage(runtime, appDir, imageName, steps) {
    steps.push(`Building image with ${runtime}...`);
    const buildCmd = `${runtime} build --platform linux/amd64 -t ${imageName} ${appDir}`;
    const { stdout, stderr } = await execAsync(buildCmd);
    if (stderr && !stderr.includes('WARNING')) {
        steps.push(`Build warnings: ${stderr}`);
    }
    steps.push('✅ Image built successfully');
}
/**
 * Push image to registry
 */
async function pushImage(runtime, imageName, steps) {
    steps.push('Pushing image to registry...');
    const pushCmd = `${runtime} push ${imageName}`;
    await execAsync(pushCmd);
    steps.push('✅ Image pushed successfully');
}
/**
 * Deploy or update application
 */
async function deployApplication(token, region, projectId, appName, imageName, port, steps) {
    const apiUrl = `https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}/apps`;
    // Check if app exists
    let appExists = false;
    try {
        await axios.get(`${apiUrl}/${appName}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        appExists = true;
        steps.push(`Application '${appName}' exists, updating...`);
    }
    catch {
        steps.push(`Creating new application '${appName}'...`);
    }
    const appSpec = {
        name: appName,
        image_reference: imageName,
        image_port: port,
        scale_min_instances: 0,
        scale_max_instances: 1,
        scale_cpu_limit: '0.25',
        scale_memory_limit: '0.5G'
    };
    if (appExists) {
        // Update existing app
        await axios.patch(`${apiUrl}/${appName}`, appSpec, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/merge-patch+json'
            }
        });
        steps.push('✅ Application updated');
    }
    else {
        // Create new app
        await axios.post(apiUrl, appSpec, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        steps.push('✅ Application created');
    }
    // Get application URL
    const appResponse = await axios.get(`${apiUrl}/${appName}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return appResponse.data.status?.url || '';
}
/**
 * Enhanced deployment with context discovery
 */
export async function deployWithContext(spec) {
    const steps = [];
    const apiKey = process.env.IBMCLOUD_API_KEY;
    const region = spec.region || 'us-south';
    if (!apiKey) {
        return {
            success: false,
            appName: spec.appName,
            projectName: '',
            projectId: '',
            error: 'IBMCLOUD_API_KEY environment variable not set',
            steps
        };
    }
    try {
        // Step 1: Discover deployment context
        steps.push('🔍 Discovering deployment context...');
        const context = await discoverContext(apiKey, region);
        steps.push(`✅ Found ${context.projects.length} project(s), ${context.applications.length} application(s)`);
        // Step 2: Select project
        let selectedProject;
        if (spec.projectName) {
            // Use specified project
            const project = findProjectByName(context.projects, spec.projectName);
            if (!project) {
                throw new Error(`Project '${spec.projectName}' not found`);
            }
            selectedProject = project;
            steps.push(`✅ Using project: ${selectedProject.name}`);
        }
        else if (spec.interactive && context.projects.length > 1) {
            // Interactive selection
            selectedProject = await selectProjectInteractive(context.projects);
            steps.push(`✅ Selected project: ${selectedProject.name}`);
        }
        else if (context.projects.length === 1) {
            // Auto-select if only one project
            selectedProject = context.projects[0];
            steps.push(`✅ Auto-selected project: ${selectedProject.name}`);
        }
        else {
            throw new Error('Multiple projects found. Please specify projectName or use interactive mode.');
        }
        // Step 3: Get IAM token
        steps.push('🔐 Authenticating with IBM Cloud...');
        const token = await getIAMToken(apiKey);
        steps.push('✅ Authentication successful');
        // Step 4: Detect container runtime
        steps.push('🔍 Detecting container runtime...');
        const runtime = await detectRuntime();
        steps.push(`✅ Using ${runtime}`);
        // Step 5: Build image
        const namespace = spec.namespace || 'mvk-namespace';
        const imageName = `us.icr.io/${namespace}/${spec.appName}:latest`;
        await buildImage(runtime, spec.appDir, imageName, steps);
        // Step 6: Push image
        await pushImage(runtime, imageName, steps);
        // Step 7: Deploy application
        const port = spec.port || 8080;
        const url = await deployApplication(token, region, selectedProject.id, spec.appName, imageName, port, steps);
        steps.push(`✅ Application deployed: ${url}`);
        return {
            success: true,
            appName: spec.appName,
            projectName: selectedProject.name,
            projectId: selectedProject.id,
            url,
            imageTag: imageName,
            steps,
            context
        };
    }
    catch (error) {
        steps.push(`❌ Deployment failed: ${error.message}`);
        return {
            success: false,
            appName: spec.appName,
            projectName: spec.projectName || '',
            projectId: '',
            error: error.message,
            steps
        };
    }
}
// CLI interface
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;
if (isMainModule) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: npx tsx deploy-tool-enhanced.ts <app-name> <app-dir> [options]');
        console.log('\nOptions:');
        console.log('  --project <name>     Project name (optional, will prompt if not provided)');
        console.log('  --namespace <name>   Registry namespace (default: mvk-namespace)');
        console.log('  --port <number>      Application port (default: 8080)');
        console.log('  --region <region>    IBM Cloud region (default: us-south)');
        console.log('  --interactive        Enable interactive mode');
        process.exit(1);
    }
    const spec = {
        appName: args[0],
        appDir: args[1],
        interactive: args.includes('--interactive')
    };
    // Parse options
    for (let i = 2; i < args.length; i++) {
        if (args[i] === '--project' && args[i + 1]) {
            spec.projectName = args[i + 1];
            i++;
        }
        else if (args[i] === '--namespace' && args[i + 1]) {
            spec.namespace = args[i + 1];
            i++;
        }
        else if (args[i] === '--port' && args[i + 1]) {
            spec.port = parseInt(args[i + 1]);
            i++;
        }
        else if (args[i] === '--region' && args[i + 1]) {
            spec.region = args[i + 1];
            i++;
        }
    }
    console.log('🚀 Enhanced Code Engine Deployment\n');
    console.log('Author: Markus van Kempen | markus.van.kempen@gmail.com');
    console.log('Research | Floor 7½ 🏢🤏\n');
    deployWithContext(spec)
        .then(result => {
        console.log('\n' + '='.repeat(60));
        console.log('DEPLOYMENT SUMMARY');
        console.log('='.repeat(60));
        result.steps.forEach(step => console.log(step));
        if (result.success) {
            console.log('\n✅ Deployment successful!');
            console.log(`\nApplication: ${result.appName}`);
            console.log(`Project: ${result.projectName}`);
            console.log(`URL: ${result.url}`);
            console.log(`Image: ${result.imageTag}`);
            if (result.context) {
                console.log(`\nTotal projects: ${result.context.projects.length}`);
                console.log(`Total applications: ${result.context.applications.length}`);
            }
        }
        else {
            console.log('\n❌ Deployment failed');
            console.log(`Error: ${result.error}`);
            process.exit(1);
        }
    })
        .catch(error => {
        console.error('\n❌ Unexpected error:', error.message);
        process.exit(1);
    });
}
// Made by MVK
//# sourceMappingURL=deploy-tool-enhanced.js.map