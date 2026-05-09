# Star Wars Splash — Quick Start Example

A Star Wars opening-crawl splash page that demonstrates deploying a static container to IBM Code Engine via the MCP server.

**Live demo:** https://starwars-splash.jqu1wkh2th6.us-south.codeengine.appdomain.cloud

---

## What's included

| File | Purpose |
|------|---------|
| `index.html` | Animated Star Wars crawl with canvas starfield |
| `Dockerfile` | nginx:alpine, remapped to port 8080 (required by Code Engine) |

---

## 🤖 The Agentic Experience

Deploying this app is as simple as talking to your AI assistant. You do not need to know how to use the Docker CLI or the IBM Cloud CLI.

### Option A: The "One-Shot" Deployment

You can ask the assistant to handle the entire end-to-end process in a single prompt.

**Ask your assistant:**
> "I have a Star Wars splash page here. Please build it for linux/amd64, push it to my ICR namespace, and deploy it to my Code Engine project. If I don't have a pull secret, create one using my API key first. Let me know when it's live!"

---

### Option B: Step-by-Step Conversation

If you prefer to see how the assistant works step-by-step, try this conversational flow:

#### 1. Build & Push
**Ask your assistant:**
> "Build the Star Wars splash page in this directory as `us.icr.io/my-namespace/starwars-splash:v1.0.0` for linux/amd64 and push it"

#### 2. Setup Prerequisites (Once per project)
**Ask your assistant:**
> "Create a registry secret called `icr-pull-secret` in project `<project-id>` for `us.icr.io` using my IBM Cloud API key"

#### 3. Deploy
**Ask your assistant:**
> "Deploy `us.icr.io/my-namespace/starwars-splash:v1.0.0` to Code Engine project `<project-id>` as app 'starwars-splash' using pull secret `icr-pull-secret`, min 1 instance"

#### 4. Verify
**Ask your assistant:**
> "Get details for the `starwars-splash` app in project `<project-id>` and confirm the instance is running"

---

## Custom Domain Setup (optional)

Map a custom domain (e.g. `starwars.example.com`) to the deployed app using a Let's Encrypt TLS certificate.

> **Important:** The IBM Code Engine REST API always requires a real TLS certificate. The Console's "Platform managed" option is not available via the API.

### Step A — Get a Let's Encrypt certificate (certbot)

```bash
# Install certbot (once)
brew install certbot

# Request the certificate — certbot pauses for a DNS challenge
mkdir -p ~/certbot/{config,work,logs}
/opt/homebrew/bin/certbot certonly --manual --preferred-challenges dns \
  -d starwars.example.com \
  --agree-tos --no-eff-email --email you@example.com \
  --config-dir ~/certbot/config \
  --work-dir ~/certbot/work \
  --logs-dir ~/certbot/logs
```

Certbot prints a DNS challenge. In your DNS provider, add:

```
_acme-challenge.starwars.example.com  TXT  "<challenge-value>"
```

Verify propagation (`dig TXT _acme-challenge.starwars.example.com +short`), then press **Enter** in certbot.

Certbot writes:
- `~/certbot/config/live/starwars.example.com/fullchain.pem`
- `~/certbot/config/live/starwars.example.com/privkey.pem`

### Step B — Create the TLS secret in Code Engine

Ask your AI assistant:
```
Create a TLS secret called starwars-tls in project <project-id>
using cert ~/certbot/config/live/starwars.example.com/fullchain.pem
and key ~/certbot/config/live/starwars.example.com/privkey.pem
```

This uses `ce_create_tls_secret_from_pem`. Or use `proc_setup_custom_domain` to do steps B + C in one shot:

```
Set up custom domain starwars.example.com for app starwars-splash
in project <project-id>
using cert ~/certbot/config/live/starwars.example.com/fullchain.pem
and key ~/certbot/config/live/starwars.example.com/privkey.pem
```

### Step C — Create the domain mapping

Ask your AI assistant:
```
Map domain starwars.example.com to app starwars-splash
in project <project-id> using TLS secret starwars-tls
```

This uses `ce_create_domain_mapping` and returns the `cname_target`:

```json
{
  "name": "starwars.example.com",
  "status": "ready",
  "cname_target": "custom.<subdomain>.<region>.codeengine.appdomain.cloud",
  "tls_secret": "starwars-tls"
}
```

### Step D — Add CNAME to your DNS

In your DNS provider, add:

```
starwars.example.com  CNAME  custom.<subdomain>.<region>.codeengine.appdomain.cloud
```

Use the exact `cname_target` from Step C (it starts with `custom.`, not the app name).

Verify DNS propagation:
```bash
dig starwars.example.com CNAME +short
```

Once propagated, `https://starwars.example.com` serves the app with a valid TLS certificate.

### Certificate renewal

Let's Encrypt certs expire after **90 days**. To renew:

1. Re-run certbot (Step A) — it will issue new PEM files
2. Ask your assistant: `Renew TLS secret starwars-tls in project <project-id> using the new PEM files at ~/certbot/config/live/starwars.example.com/`

This uses `ce_renew_tls_secret_from_pem` which patches the secret in-place — no changes to the domain mapping required.

---

## Port note

Code Engine requires containers to listen on **port 8080**. The Dockerfile patches nginx's default config from port 80 → 8080 at build time.

---

## Author

Markus van Kempen  
Email: `markus.van.kempen@gmail.com` | `mvankempen@ca.ibm.com`  
Website: [markusvankempen.github.io](https://markusvankempen.github.io/)  
Research | Floor 7 1/2
