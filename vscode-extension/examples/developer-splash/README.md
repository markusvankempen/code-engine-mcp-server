# Developer Splash — Quick Start Example

A personal developer profile card deployed as a static nginx container on IBM Code Engine via the MCP server.

**Live demo:** https://developer-splash.29m5mrru3s3n.ca-tor.codeengine.appdomain.cloud

---

## What's included

| File | Purpose |
|------|---------|
| `index.html` | Dark-mode developer profile card (IBM Cloud / MCP branding) |
| `Dockerfile` | nginx:alpine, remapped to port 8080 (required by Code Engine) |

---

## 🤖 The Agentic Experience

Deploying this app is as simple as talking to your AI assistant. You do not need to know how to use the Docker CLI or the IBM Cloud CLI.

### Option A: The "One-Shot" Deployment

You can ask the assistant to handle the entire end-to-end process in a single prompt.

**Ask your assistant:**
> "I have an app in the `examples/developer-splash` folder. Please build it for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first. Let me know when it's live!"

The assistant will figure out the project, namespace, and run the complete build → push → deploy → wait pipeline for you.

---

### Option B: Step-by-Step Conversation

If you prefer to see how the assistant works step-by-step, try this conversational flow:

#### 1. Validate the setup
**Ask your assistant:**
> "Can you validate the Dockerfile in `examples/developer-splash` to ensure it's compatible with Code Engine?"

#### 2. Build & Push
**Ask your assistant:**
> "Please build the `examples/developer-splash` app and push it to my IBM Container Registry."

#### 3. Setup Prerequisites (Once per project)
**Ask your assistant:**
> "Check if I have a registry pull secret in my Code Engine project. If not, create one called `icr-pull-secret` using my IBM Cloud API key."

#### 4. Deploy
**Ask your assistant:**
> "Deploy the image you just pushed to my Code Engine project. Call the app 'developer-splash'."

#### 5. Verify
**Ask your assistant:**
> "Is the 'developer-splash' app ready? What is the public URL?"

## Dockerfile notes

- nginx:alpine is used — extremely small image (~8 MB).
- The `sed` command uses `[[:space:]]*` (POSIX character class) instead of a fixed number of spaces. nginx:alpine's `default.conf` uses inconsistent whitespace, so exact-string patterns like `'listen  80;'` silently fail — use the portable form.
- No `USER` instruction is needed for nginx:alpine (it drops to a non-root worker process automatically).
