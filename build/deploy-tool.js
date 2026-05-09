/**
 * Code Engine Automated Deployment Tool
 *
 * Author: Markus van Kempen | markus.van.kempen@gmail.com
 * Research | Floor 7½ 🏢🤏 | https://markusvankempen.github.io/
 * No bug too small, no syntax too weird.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
const execAsync = promisify(exec);
async function getApplicationLogs(projectId, appName, token, region) {
    try {
        // Get the application to find its instances
        const appResponse = await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}/apps/${appName}`, { headers: { 'Authorization': `Bearer ${token}` } });
        // Get instances for the application
        const instancesResponse = await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}/apps/${appName}/instances`, { headers: { 'Authorization': `Bearer ${token}` } });
        const logs = [];
        if (instancesResponse.data.instances && instancesResponse.data.instances.length > 0) {
            // Get logs from the first running instance
            const instance = instancesResponse.data.instances[0];
            logs.push(`\n=== Logs from instance: ${instance.name} ===`);
            logs.push(`Status: ${instance.status}`);
            logs.push(`Created: ${instance.created_at}`);
            // Try to get logs via API (if available)
            try {
                const logsResponse = await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${projectId}/apps/${appName}/instances/${instance.name}/logs`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (logsResponse.data.logs) {
                    logs.push('\n--- Application Logs ---');
                    logs.push(logsResponse.data.logs);
                }
            }
            catch (logError) {
                logs.push('\nNote: Real-time logs available via IBM Cloud Console or CLI');
                logs.push(`View logs: ibmcloud ce app logs --name ${appName}`);
            }
        }
        else {
            logs.push('\nNo running instances found yet. Application may still be starting.');
            logs.push(`Check status: ibmcloud ce app get --name ${appName}`);
            logs.push(`View logs: ibmcloud ce app logs --name ${appName} --follow`);
        }
        return logs;
    }
    catch (error) {
        return [
            '\nNote: Unable to fetch logs via API',
            `View logs in IBM Cloud Console or use: ibmcloud ce app logs --name ${appName} --follow`,
            `Error: ${error.message}`
        ];
    }
}
export async function deployToCodeEngine(spec) {
    const steps = [];
    const apiKey = process.env.IBMCLOUD_API_KEY;
    const region = spec.region || 'us-south';
    const namespace = spec.namespace || 'mvk-code-engine';
    if (!apiKey) {
        return {
            success: false,
            appName: spec.appName,
            error: 'IBMCLOUD_API_KEY not found in environment',
            steps
        };
    }
    try {
        // Step 1: Detect container runtime
        steps.push('Detecting container runtime...');
        const { stdout: podmanCheck } = await execAsync('which podman').catch(() => ({ stdout: '' }));
        const { stdout: dockerCheck } = await execAsync('which docker').catch(() => ({ stdout: '' }));
        const runtime = podmanCheck ? 'podman' : dockerCheck ? 'docker' : null;
        if (!runtime) {
            throw new Error('No container runtime (docker or podman) found');
        }
        steps.push(`✓ Using ${runtime}`);
        // Step 2: Build image with correct architecture
        const imageTag = `us.icr.io/${namespace}/${spec.appName}:latest`;
        steps.push(`Building image: ${imageTag}`);
        const buildCmd = `cd ${spec.appDir} && ${runtime} build --platform linux/amd64 -t ${imageTag} .`;
        await execAsync(buildCmd);
        steps.push('✓ Image built successfully');
        // Step 3: Login to IBM Container Registry
        steps.push('Authenticating with IBM Container Registry...');
        const loginCmd = `echo "${apiKey}" | ${runtime} login -u iamapikey --password-stdin us.icr.io`;
        await execAsync(loginCmd);
        steps.push('✓ Authenticated');
        // Step 4: Push image
        steps.push('Pushing image to registry...');
        await execAsync(`${runtime} push ${imageTag}`);
        steps.push('✓ Image pushed');
        // Step 5: Get IAM token
        steps.push('Getting IAM token...');
        const tokenResponse = await axios.post('https://iam.cloud.ibm.com/identity/token', new URLSearchParams({
            grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
            apikey: apiKey
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const token = tokenResponse.data.access_token;
        steps.push('✓ Token obtained');
        // Step 6: List projects and get first active one
        steps.push('Finding Code Engine project...');
        const projectsResponse = await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects`, { headers: { 'Authorization': `Bearer ${token}` } });
        const project = projectsResponse.data.projects?.find((p) => p.status === 'active') ||
            projectsResponse.data.projects?.[0];
        if (!project) {
            throw new Error('No Code Engine projects found');
        }
        steps.push(`✓ Using project: ${project.name}`);
        // Step 7: Ensure registry secret exists
        steps.push('Configuring registry access...');
        try {
            await axios.post(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${project.id}/secrets`, {
                name: 'icr-pull-secret',
                format: 'registry',
                data: {
                    username: 'iamapikey',
                    password: apiKey,
                    server: 'us.icr.io'
                }
            }, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
            steps.push('✓ Registry secret created');
        }
        catch (error) {
            if (error.response?.status === 409) {
                steps.push('✓ Registry secret already exists');
            }
            else {
                throw error;
            }
        }
        // Step 8: Deploy or update application
        steps.push('Deploying application...');
        // Check if app exists
        let appExists = false;
        try {
            await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${project.id}/apps/${spec.appName}`, { headers: { 'Authorization': `Bearer ${token}` } });
            appExists = true;
        }
        catch (error) {
            if (error.response?.status !== 404) {
                throw error;
            }
        }
        let appUrl;
        if (appExists) {
            // Update existing app
            steps.push('Updating existing application...');
            const getResponse = await axios.get(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${project.id}/apps/${spec.appName}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const updateResponse = await axios.patch(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${project.id}/apps/${spec.appName}`, {
                image_reference: imageTag,
                run_env_variables: [
                    ...getResponse.data.run_env_variables.filter((v) => v.name !== 'DEPLOY_TIME'),
                    { type: 'literal', name: 'DEPLOY_TIME', value: new Date().toISOString() }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/merge-patch+json',
                    'If-Match': getResponse.data.entity_tag
                }
            });
            appUrl = updateResponse.data.endpoint;
            steps.push('✓ Application updated');
        }
        else {
            // Create new app
            steps.push('Creating new application...');
            const createResponse = await axios.post(`https://api.${region}.codeengine.cloud.ibm.com/v2/projects/${project.id}/apps`, {
                name: spec.appName,
                image_reference: imageTag,
                image_secret: 'icr-pull-secret',
                image_port: spec.port || 8000,
                scale_min_instances: 0,
                scale_max_instances: 2,
                scale_cpu_limit: '0.25',
                scale_memory_limit: '0.5G',
                run_env_variables: spec.message ? [
                    { type: 'literal', name: 'MESSAGE', value: spec.message },
                    { type: 'literal', name: 'NODE_ENV', value: 'production' }
                ] : [
                    { type: 'literal', name: 'NODE_ENV', value: 'production' }
                ]
            }, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
            appUrl = createResponse.data.endpoint;
            steps.push('✓ Application created');
        }
        steps.push('✓ Deployment complete!');
        steps.push('\nFetching application logs...');
        // Wait a moment for the app to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Get application logs
        const logs = await getApplicationLogs(project.id, spec.appName, token, region);
        steps.push('✓ Logs retrieved');
        return {
            success: true,
            appName: spec.appName,
            url: appUrl,
            imageTag,
            steps,
            logs
        };
    }
    catch (error) {
        steps.push(`✗ Error: ${error.message}`);
        return {
            success: false,
            appName: spec.appName,
            error: error.message,
            steps
        };
    }
}
// Made by MVK
//# sourceMappingURL=deploy-tool.js.map