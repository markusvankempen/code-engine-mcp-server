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
import { DeploymentContext } from './context-discovery.js';
interface EnhancedDeploymentSpec {
    appName: string;
    appDir: string;
    message?: string;
    port?: number;
    region?: string;
    projectName?: string;
    namespace?: string;
    interactive?: boolean;
}
interface DeploymentResult {
    success: boolean;
    appName: string;
    projectName: string;
    projectId: string;
    url?: string;
    imageTag?: string;
    error?: string;
    steps: string[];
    logs?: string[];
    context?: DeploymentContext;
}
/**
 * Enhanced deployment with context discovery
 */
export declare function deployWithContext(spec: EnhancedDeploymentSpec): Promise<DeploymentResult>;
export {};
//# sourceMappingURL=deploy-tool-enhanced.d.ts.map