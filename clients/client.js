document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const node = document.getElementById(button.dataset.copy);
    if (!node) return;
    await navigator.clipboard.writeText(node.textContent.trim());
    const previous = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = previous; }, 1200);
  });
});

function mcpUrlDefault() {
  if (location.protocol.startsWith("http") && location.pathname.includes("/clients")) {
    return `${location.origin}/mcp`;
  }
  return "http://127.0.0.1:8787/mcp";
}

function payloadOf(message) {
  const structured = message?.result?.structuredContent;
  if (structured && typeof structured === "object") return structured;
  const text = (message?.result?.content || []).find((part) => part.type === "text")?.text;
  if (!text) return structured || null;
  try { return JSON.parse(text); } catch { return { text }; }
}

function errorText(message, response) {
  if (message?.error?.message) return message.error.message;
  const text = (message?.result?.content || []).find((part) => part.type === "text")?.text;
  if (message?.result?.isError && text) {
    try {
      const body = JSON.parse(text);
      return body.error || text;
    } catch {
      return text;
    }
  }
  if (response && !response.ok) return `HTTP ${response.status}`;
  return "";
}

async function readBody(response) {
  const text = await response.text();
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/event-stream") || text.trimStart().startsWith("data:")) {
    const messages = text.split("\n")
      .filter((row) => row.startsWith("data:"))
      .map((row) => JSON.parse(row.slice(5).trim()));
    return messages.at(-1) || { raw: text };
  }
  try { return JSON.parse(text); } catch { return { raw: text, status: response.status }; }
}

/** Format an ISO timestamp in the browser's local timezone. Other strings are returned unchanged. */
function formatLocalTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value ?? "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

const SECRET_ARG = /^(ibmcloud_api_key|code_engine_api_key|admin_password|password|api_key|apikey)$/i;

function redactForDisplay(value) {
  if (Array.isArray(value)) return value.map(redactForDisplay);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_ARG.test(key) && item ? "***" : redactForDisplay(item);
    }
    return out;
  }
  return value;
}

function authorizationHeader() {
  const user = document.getElementById("basicUser")?.value.trim();
  const pass = document.getElementById("basicPass")?.value ?? "";
  if (user) {
    const bytes = new TextEncoder().encode(`${user}:${pass}`);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }
  const key = document.getElementById("key")?.value.trim();
  return key ? `Bearer ${key}` : "";
}

async function mcpRpc(method, params, quiet) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const authorization = authorizationHeader();
  if (authorization) headers.Authorization = authorization;
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const url = document.getElementById("url").value.trim();
  const sent = document.getElementById("sent");
  const raw = document.getElementById("raw");
  const shown = { ...headers };
  if (shown.Authorization?.startsWith("Basic ")) shown.Authorization = "Basic ***";
  else if (shown.Authorization) shown.Authorization = "Bearer ***";
  if (!quiet && sent) sent.textContent = JSON.stringify({ url, headers: shown, body: redactForDisplay(body) }, null, 2);
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const message = await readBody(response);
  if (!quiet && raw) raw.textContent = JSON.stringify(message, null, 2);
  const failure = errorText(message, response);
  if (failure) throw new Error(failure);
  return message;
}

async function callTool(name, args) {
  const message = await mcpRpc("tools/call", { name, arguments: args });
  return payloadOf(message);
}
