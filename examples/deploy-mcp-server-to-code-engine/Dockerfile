# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /build

# Copy config files first
COPY package.json tsconfig.json ./

# Install dependencies (skip prepare script to avoid tsc running without source)
RUN npm install --ignore-scripts

# Copy source
COPY src/ ./src/

# Run build explicitly
RUN npm run build

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Copy built server and dependencies
COPY --from=builder /build/build/ ./build/
COPY --from=builder /build/node_modules/ ./node_modules/
COPY --from=builder /build/package.json ./

# Copy the SSE bridge
COPY bridge.mjs ./bridge.mjs

EXPOSE 8080

# Environment variables
ENV IBMCLOUD_API_KEY=""
ENV IBMCLOUD_REGION="us-south"
# Point to the locally built index.js
ENV MCP_BIN="node ./build/index.js"

USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "/app/bridge.mjs"]
