import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8940 + Math.floor(Math.random() * 9);
const ADMIN_PORT = PORT + 1;
const TOKEN = "phase2-token-0123456789abcdef";
const ADMIN_SECRET = "admin-secret-0123456789abcdef";
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = `http://127.0.0.1:${ADMIN_PORT}`;
let srv: ChildProcess | undefined;
let ws: string;

const hdr = (token: string, sid?: string) => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${token}`,
  ...(sid ? { "mcp-session-id": sid } : {}),
});
const parse = (t: string) => {
  const l = t.split("\n").find((x) => x.startsWith("data:"));
  return JSON.parse(l ? l.slice(5).trim() : t);
};

async function initSession(token: string): Promise<string> {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: hdr(token),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
  });
  const sid = r.headers.get("mcp-session-id")!;
  await fetch(`${BASE}/mcp`, { method: "POST", headers: hdr(token, sid), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  return sid;
}
async function callTool(token: string, sid: string, name: string, args: any) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: hdr(token, sid),
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }),
  });
  return parse(await r.text()).result;
}
const txt = (res: any) => res.content[0].text as string;

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-p2-"));
  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      BRIDGE_MODE: "admin", BRIDGE_ADMIN_ACK: "I_UNDERSTAND_FULL_PC_ACCESS", BRIDGE_APPROVAL: "auto",
      BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_ADMIN_PORT: String(ADMIN_PORT),
      BRIDGE_ADMIN_SECRET: ADMIN_SECRET, BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com", BRIDGE_WORKSPACE: ws,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
}, 25000);

afterAll(() => {
  srv?.kill();
  if (ws) rmSync(ws, { recursive: true, force: true });
});

describe("Fase 2 — segurança operacional", () => {
  it("ownership: uma sessão não vê o job de outra", async () => {
    const a = await initSession(TOKEN);
    const b = await initSession(TOKEN);
    const started = txt(await callTool(TOKEN, a, "run_job", { command: "node -e \"setTimeout(()=>{},300)\"", cwd: "." }));
    const jobId = started.match(/Job iniciado: ([a-f0-9]+)/)![1];
    // Sessão A vê o job:
    const aStatus = await callTool(TOKEN, a, "job_status", { job_id: jobId });
    expect(txt(aStatus)).toContain(jobId);
    // Sessão B NÃO vê (JobManager isolado por sessão):
    const bStatus = await callTool(TOKEN, b, "job_status", { job_id: jobId });
    expect(bStatus.isError).toBe(true);
  });

  it("admin status responde na porta local com o segredo", async () => {
    const r = await fetch(`${ADMIN}/admin/status`, { headers: { "x-admin-secret": ADMIN_SECRET } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.hasToken).toBe(true);
  });

  it("admin exige o segredo", async () => {
    const r = await fetch(`${ADMIN}/admin/status`, { headers: { "x-admin-secret": "errado" } });
    expect(r.status).toBe(401);
  });

  it("rotate invalida o token antigo", async () => {
    const r = await fetch(`${ADMIN}/admin/rotate`, { method: "POST", headers: { "x-admin-secret": ADMIN_SECRET } });
    const { token: novo } = await r.json();
    expect(novo).toBeTruthy();
    // Token antigo agora falha:
    const old = await fetch(`${BASE}/mcp`, { method: "POST", headers: hdr(TOKEN), body: "{}" });
    expect(old.status).toBe(401);
    // Novo token inicia sessão:
    const sid = await initSession(novo);
    expect(sid).toBeTruthy();
  });

  it("panic revoga o token e derruba tudo", async () => {
    const r = await fetch(`${ADMIN}/admin/panic`, { method: "POST", headers: { "x-admin-secret": ADMIN_SECRET } });
    expect((await r.json()).stopped).toBe(true);
    const st = await fetch(`${ADMIN}/admin/status`, { headers: { "x-admin-secret": ADMIN_SECRET } });
    expect((await st.json()).hasToken).toBe(false);
  });

  it("lockout: muitas tentativas inválidas resultam em 429", async () => {
    let last = 0;
    for (let i = 0; i < 9; i++) {
      const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: hdr("token-invalido-xxxxxxxx"), body: "{}" });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
