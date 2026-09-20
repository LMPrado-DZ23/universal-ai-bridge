import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8870 + Math.floor(Math.random() * 9);
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const BASE = `http://127.0.0.1:${PORT}`;
let srv: ChildProcess | undefined;
let ws: string;

const H = (sid?: string) => ({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}`, ...(sid ? { "mcp-session-id": sid } : {}) });
const parse = (t: string) => { const l = t.split("\n").find((x) => x.startsWith("data:")); return JSON.parse(l ? l.slice(5).trim() : t); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function initSession(): Promise<string> {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  const sid = r.headers.get("mcp-session-id")!;
  await fetch(`${BASE}/mcp`, { method: "POST", headers: H(sid), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  return sid;
}
async function callTool(sid: string, name: string, args: any) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(sid), body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }) });
  return parse(await r.text()).result;
}

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-sess-"));
  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, BRIDGE_MODE: "admin", BRIDGE_ADMIN_ACK: "I_UNDERSTAND_FULL_PC_ACCESS", BRIDGE_APPROVAL: "auto", BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_DATA_DIR: ws, BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com", BRIDGE_WORKSPACE: ws },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await wait(200); }
}, 25000);

afterAll(() => { srv?.kill(); if (ws) rmSync(ws, { recursive: true, force: true }); });

describe("Fase 1 — cleanup por sessão", () => {
  it("fechar a sessão (DELETE) mata o job infinito (C3)", async () => {
    const sid = await initSession();
    // Job que escreve o timestamp num arquivo a cada 150ms.
    const cmd = `node -e "const fs=require('fs');setInterval(()=>fs.writeFileSync('alive.txt',String(Date.now())),150)"`;
    const started = await callTool(sid, "run_job", { command: cmd, cwd: "." });
    expect(started.isError).toBeFalsy();
    const alive = join(ws, "alive.txt");
    for (let i = 0; i < 20 && !existsSync(alive); i++) await wait(150);
    expect(existsSync(alive)).toBe(true);

    // Fecha a sessão → deve descartar recursos e matar a árvore.
    await fetch(`${BASE}/mcp`, { method: "DELETE", headers: H(sid) });
    await wait(600);
    const t1 = statSync(alive).mtimeMs;
    await wait(1000);
    const t2 = statSync(alive).mtimeMs;
    expect(t2).toBe(t1); // processo morto → arquivo não avança mais
  }, 20000);

  it("HTTP health e outra sessão respondem durante comando longo", async () => {
    const a=await initSession(), b=await initSession();
    let ended=false;
    const long=callTool(a,'run_command',{program:'node',args:['-e','setTimeout(()=>process.stdout.write("done"),1500)']}).then(r=>{ended=true;return r;});
    await wait(150);
    const health=await fetch(`${BASE}/health`,{signal:AbortSignal.timeout(700)});
    expect(health.ok).toBe(true);
    const second=await callTool(b,'get_workspace_info',{});
    expect(second.isError).toBeFalsy();expect(ended).toBe(false);
    expect((await long).content[0].text).toContain('done');
    await fetch(`${BASE}/mcp`,{method:'DELETE',headers:H(a)});await fetch(`${BASE}/mcp`,{method:'DELETE',headers:H(b)});
  });

  it("run_command NÃO grava o comando/segredo no audit (C5)", async () => {
    const sid = await initSession();
    await callTool(sid, "run_command", { command: "echo TOPSECRET_AUDIT_VALUE", cwd: "." });
    const auditDir = join(ws, "audit");
    const files = existsSync(auditDir) ? readdirSync(auditDir) : [];
    let all = "";
    for (const f of files) all += readFileSync(join(auditDir, f), "utf8");
    expect(all).toContain("run_command"); // registrou o evento
    expect(all).not.toContain("TOPSECRET_AUDIT_VALUE"); // mas não o segredo
  }, 15000);
});
