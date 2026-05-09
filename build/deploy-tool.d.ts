/**
 * Code Engine Automated Deployment Tool
 *
 * Author: Markus van Kempen | markus.van.kempen@gmail.com
 * Research | Floor 7½ 🏢🤏 | https://markusvankempen.github.io/
 * No bug too small, no syntax too weird.
 */
interface DeploymentSpec {
    appName: string;
    appDir: string;
    message?: string;
    port?: number;
    region?: string;
    namespace?: string;
}
interface DeploymentResult {
    success: boolean;
    appName: string;
    url?: string;
    imageTag?: string;
    error?: string;
    steps: string[];
    logs?: string[];
}
export declare function deployToCodeEngine(spec: DeploymentSpec): Promise<DeploymentResult>;
export {};
//# sourceMappingURL=deploy-tool.d.ts.map