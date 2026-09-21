import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8930 + Math.floor(Math.random() * 9);
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const BASE = `http://127.0.0.1:${PORT}`;
let srv: ChildProcess | undefined;
let ws: string;
let sid: string;

const H = () => ({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}`, ...(sid ? { "mcp-session-id": sid } : {}) });
const parse = (t: string) => { const l = t.split("\n").find((x) => x.startsWith("data:")); return JSON.parse(l ? l.slice(5).trim() : t); };
async function call(name: string, args: any) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }) });
  return parse(await r.text()).result;
}
const txt = (res: any) => res.content[0].text as string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-pty-"));
  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, BRIDGE_MODE: "admin", BRIDGE_ADMIN_ACK: "I_UNDERSTAND_FULL_PC_ACCESS", BRIDGE_APPROVAL: "auto", BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_DATA_DIR: ws, BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com", BRIDGE_WORKSPACE: ws },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const init = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  sid = init.headers.get("mcp-session-id")!;
  await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
}, 25000);

afterAll(() => { srv?.kill(); if (ws) rmSync(ws, { recursive: true, force: true }); });

describe("Fase 4 — PTY", () => {
  it("pty_start roda um comando no pseudo-terminal e captura a saída", async () => {
    const start = await call("pty_start", { command: `node -e "process.stdout.write('PTYOK123')"`, cwd: "." });
    if (start.isError && /indispon/i.test(txt(start))) {
      // PTY não disponível nesta plataforma — fallback documentado.
      return;
    }
    const id = txt(start).match(/PTY iniciado: ([a-f0-9]+)/)![1];
    let data = "";
    for (let i = 0; i < 15; i++) {
      await wait(200);
      const out = JSON.parse(txt(await call("pty_output", { pty_id: id, since: 0 })));
      data = out.data;
      if (data.includes("PTYOK123")) break;
    }
    await call("pty_kill", { pty_id: id });
    expect(data).toContain("PTYOK123");
  }, 15000);
});
