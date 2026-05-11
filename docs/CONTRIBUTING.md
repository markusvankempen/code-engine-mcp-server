# Contributing to IBM Code Engine MCP Server

First off, thank you for considering contributing! The `code-engine-mcp-server` project is an open-source initiative to enable AI-driven deployment for IBM Code Engine. We welcome contributions from the community.

## 🛠 Tech Stack

- **Runtime**: Node.js 24+ (pinned via `mise`)
- **Language**: TypeScript (ESM / Node16 modules)
- **Testing**: Jest + ts-jest
- **Key Libraries**:
  - `@modelcontextprotocol/sdk` — core MCP implementation
  - `axios` — IBM Cloud API calls
  - `dotenv` — environment configuration

---

## 🚀 Environment Setup

We use [`mise`](https://mise.jdx.dev) to pin the Node.js version consistently.

1. **Fork and clone**
   ```bash
   git clone https://github.com/markusvankempen/code-engine-mcp-server.git
   cd code-engine-mcp-server
   ```

2. **Install Node.js via mise**
   ```bash
   mise install
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env   # add your IBMCLOUD_API_KEY
   ```
   > For unit tests, no live IBM Cloud connection is required — the MCP tool-discovery tests run against the local built server.

5. **Build the server**
   ```bash
   mise run build        # or: npm run build
   ```

---

## 🧪 Development Workflow

### Running tests

```bash
mise run test            # run all Jest tests
mise run test-watch      # watch mode
mise run test-coverage   # with coverage report
```

Or directly with npm:

```bash
npm test
npm run test:coverage
```

Tests live in `__tests__/` and use the `.test.ts` suffix.

### Adding a new MCP tool

1. Define the tool in `src/index.ts` (add to `containerTools` or `codeEngineTools` array)
2. Add a handler in the `CallToolRequestSchema` switch block
3. Add the tool name to `EXPECTED_*_TOOLS` in `__tests__/mcp-tools.test.ts`
4. Run `npm test` — if the new tool shows up, the test passes automatically

**Example test for a new tool:**
```typescript
test('my_new_tool responds to a valid call', async () => {
  // Use the discoverTools() helper from the test file, or write
  // a focused JSON-RPC test using spawn + JSON-RPC as shown in
  // __tests__/mcp-tools.test.ts
  expect(tools).toContain('my_new_tool');
});
```

---

## 📜 Pull Request Process

1. **Branch** off `main` — use `feature/tool-name` or `fix/description`
2. **Commit messages** — be descriptive about *why*, not just *what*
3. **Tests** — add/update tests for any new logic
4. **Docs** — update `README.md` or `docs/` if behaviour changes
5. **CI** — ensure `npm test` and `npm run build` pass locally before opening a PR
6. Open a PR against `main` and link related issues

---

## ❓ Getting Help

Open a [GitHub Issue](https://github.com/markusvankempen/code-engine-mcp-server/issues) or reach out via the contact info in `README.md`.

Happy coding! 🚀

