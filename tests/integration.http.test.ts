import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8900 + Math.floor(Math.random() * 90);
const TOKEN = "tok-integração-123";
const BASE = `http://127.0.0.1:${PORT}`;

let srv: ChildProcess | undefined;

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${TOKEN}`,
};

/** Extrai o JSON-RPC de uma resposta (JSON puro ou SSE 'data:'). */
function parseBody(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5).trim() : text);
}

async function waitHealth(timeoutMs = 12000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("servidor HTTP não respondeu /health a tempo");
}

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("dist ausente — rode `npm run build` antes dos testes.");
  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      BRIDGE_MODE: "safe",
      BRIDGE_TOKEN: TOKEN,
      BRIDGE_PORT: String(PORT),
      BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com",
      BRIDGE_ALLOW_SHELL: "false",
    },
    stdio: "ignore",
  });
  await waitHealth();
}, 20000);

afterAll(() => {
  srv?.kill();
});

describe("integração HTTP/MCP", () => {
  it("/health responde sem vazar caminho local", async () => {
    const r = await fetch(`${BASE}/health`);
    const j = await r.json();
    expect(j).toEqual({ ok: true });
  });

  it("bloqueia sem token (401) e Origin inválido (403)", async () => {
    const noTok = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(noTok.status).toBe(401);
    const badOrigin = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.com" },
      body: "{}",
    });
    expect(badOrigin.status).toBe(403);
  });

  it("faz initialize, lista tools e chama get_workspace_info", async () => {
    // initialize
    const initRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "it", version: "1" } },
      }),
    });
    expect(initRes.status).toBe(200);
    const sid = initRes.headers.get("mcp-session-id")!;
    expect(sid).toBeTruthy();
    const withSid = { ...headers, "mcp-session-id": sid };

    // initialized
    await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: withSid,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    // tools/list
    const listRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: withSid,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const list = parseBody(await listRes.text());
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain("get_workspace_info");
    expect(names).toContain("write_file");
    // shell desligado no modo safe → run_command NÃO aparece
    expect(names).not.toContain("run_command");

    // tools/call get_workspace_info
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: withSid,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_workspace_info", arguments: {} },
      }),
    });
    const call = parseBody(await callRes.text());
    const payload = JSON.parse(call.result.content[0].text);
    expect(payload.mode).toBe("safe");
    expect(payload.shell_enabled).toBe(false);
  }, 20000);
});
