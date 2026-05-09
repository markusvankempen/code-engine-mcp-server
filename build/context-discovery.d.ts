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
export declare function getIAMToken(apiKey: string): Promise<string>;
/**
 * List all Code Engine projects
 */
export declare function listProjects(token: string, region?: string): Promise<Project[]>;
/**
 * List applications in a specific project
 */
export declare function listApplicationsInProject(token: string, region: string, projectId: string): Promise<any[]>;
/**
 * List all applications across all projects
 */
export declare function listAllApplications(token: string, region?: string): Promise<Application[]>;
/**
 * List Container Registry namespaces
 * Note: This requires IBM Cloud CLI as there's no direct REST API for registry namespaces
 */
export declare function listRegistryNamespaces(token: string): Promise<RegistryNamespace[]>;
/**
 * Discover complete deployment context
 */
export declare function discoverContext(apiKey: string, region?: string): Promise<DeploymentContext>;
/**
 * Format context for display
 */
export declare function formatContext(context: DeploymentContext): string;
/**
 * Interactive project selection
 */
export declare function selectProject(projects: Project[]): void;
/**
 * Find project by name
 */
export declare function findProjectByName(projects: Project[], name: string): Project | undefined;
/**
 * Check if application exists in any project
 */
export declare function findApplication(applications: Application[], appName: string): Application | undefined;
//# sourceMappingURL=context-discovery.d.ts.map