# Code Engine MCP Client

A standalone command-line client for interacting with IBM Code Engine and Docker/Podman through the MCP (Model Context Protocol) server.

## ✅ Successfully Tested

The client has been tested and works! It successfully detected Podman:

```json
{
  "docker": null,
  "podman": "podman version 5.5.1",
  "available": "podman"
}
```

## Quick Start

### 1. Setup (Already Done!)

The MCP server and client are already built and ready to use.

### 2. Run the Client

```bash
cd code-engine-mcp-server
./run-client.sh <command> [args]
```

## Available Commands

### Docker/Podman Commands

#### Detect Container Runtime
```bash
./run-client.sh detect
```
Output: Shows which container runtime (Docker or Podman) is available

#### List Local Images
```bash
./run-client.sh images
```
Output: Lists all local container images

#### List Containers
```bash
./run-client.sh containers
```
Output: Lists all containers (running and stopped)

#### Build Container Image
```bash
./run-client.sh build <dockerfile_path> <image_name> <context_path>
```
Example:
```bash
./run-client.sh build ./Dockerfile myapp:latest .
```

#### Push Image to Registry
```bash
./run-client.sh push <image_name>
```
Example:
```bash
./run-client.sh push icr.io/namespace/myapp:latest
```

#### Test Container Locally
```bash
./run-client.sh test <image_name> [port_mapping]
```
Example:
```bash
./run-client.sh test myapp:latest 8080:8080
```

#### Get Container Logs
```bash
./run-client.sh logs <container_id>
```

#### Stop Container
```bash
./run-client.sh stop <container_id>
```

### Code Engine Commands

#### List Projects
```bash
./run-client.sh projects
```
Output: Lists all Code Engine projects

### Interactive Mode

Run without arguments for interactive mode:
```bash
./run-client.sh
```

Then use commands interactively:
```
mcp> detect
mcp> images
mcp> help
mcp> exit
```

## Configuration

The client reads the IBM Cloud API key from `../.env` file:

```bash
# .env file (in parent directory)
IBMCLOUD_API_KEY=your-api-key-here
```

## Complete Workflow Example

### Build, Test, and Deploy

```bash
# 1. Detect runtime
./run-client.sh detect

# 2. Build image
./run-client.sh build ./Dockerfile myapp:v1.0.0 .

# 3. Test locally
./run-client.sh test myapp:v1.0.0 3000:3000

# 4. Check logs
./run-client.sh logs <container_id>

# 5. Stop test container
./run-client.sh stop <container_id>

# 6. Push to registry
./run-client.sh push icr.io/namespace/myapp:v1.0.0

# 7. List Code Engine projects
./run-client.sh projects
```

## Architecture

```
┌─────────────────┐
│  MCP Client     │  (simple-client.ts)
│  (CLI)          │
└────────┬────────┘
         │
         │ spawns
         ▼
┌─────────────────┐
│  MCP Server     │  (index.ts)
│  (stdio)        │
└────────┬────────┘
         │
         ├──► Docker/Podman CLI
         │
         └──► IBM Cloud CLI
```

## How It Works

1. **Client** (`simple-client.ts`) - Command-line interface
2. **Server** (`index.ts`) - MCP server that executes commands
3. **Communication** - Client spawns server as subprocess, communicates via stdio
4. **Tools** - Server provides 8 Docker/Podman tools + 4 Code Engine tools

## Troubleshooting

### API Key Not Found

If you see:
```
❌ Error: IBM Cloud API key not found in .env file
```

Solution:
1. Check `.env` file exists in parent directory
2. Verify it contains: `IBMCLOUD_API_KEY=your-key`
3. Or run with explicit env var:
```bash
IBMCLOUD_API_KEY="your-key" ./run-client.sh detect
```

### Docker/Podman Not Found

If commands fail, verify Docker or Podman is installed:
```bash
docker --version
# or
podman --version
```

### IBM Cloud CLI Not Found

For Code Engine commands, verify IBM Cloud CLI is installed:
```bash
ibmcloud --version
ibmcloud plugin list  # Should show code-engine plugin
```

## Development

### Build
```bash
npm run build
```

### Run in Development Mode
```bash
npm run client
```

### Test Specific Command
```bash
npm start detect
npm start images
npm start projects
```

## Available Tools

The MCP server provides these tools:

### Container Tools (8)
1. `detect_container_runtime` - Detect Docker/Podman
2. `build_container_image` - Build images
3. `push_container_image` - Push to registry
4. `list_local_images` - List images
5. `test_container_locally` - Run locally
6. `get_container_logs` - View logs
7. `stop_local_container` - Stop container
8. `list_local_containers` - List containers

### Code Engine Tools (4)
1. `ce_list_projects` - List projects
2. `ce_create_application` - Create app
3. `ce_list_applications` - List apps
4. `ce_get_application` - Get app details

## Examples

### Example 1: Check What's Available
```bash
./run-client.sh detect
./run-client.sh images
./run-client.sh containers
```

### Example 2: Build and Test
```bash
# Build
./run-client.sh build ./Dockerfile myapp:test .

# Test
./run-client.sh test myapp:test 8080:8080

# Get container ID from output, then check logs
./run-client.sh logs abc123

# Stop when done
./run-client.sh stop abc123
```

### Example 3: Deploy to Registry
```bash
# Build
./run-client.sh build ./Dockerfile myapp:v1.0.0 .

# Push
./run-client.sh push icr.io/my-namespace/myapp:v1.0.0
```

### Example 4: Code Engine
```bash
# List projects
./run-client.sh projects

# Output shows your Code Engine projects
```

## Tips

1. **Use Tab Completion**: The shell script supports command completion
2. **Check Help**: Run `./run-client.sh help` for command list
3. **Interactive Mode**: Run without args for interactive prompt
4. **Environment Variables**: Can override any setting via env vars

## Next Steps

- Use the client to manage your containers
- Integrate with CI/CD pipelines
- Automate deployments to Code Engine
- Build custom workflows

## Support

For issues:
1. Check the troubleshooting section
2. Verify prerequisites are installed
3. Check `.env` file configuration
4. Review MCP_DOCKER_PODMAN_TOOLS.md for tool details