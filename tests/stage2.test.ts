import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

// Modo ADMIN + aprovação auto para exercitar env/allowlist/download/watch/media.
const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8960 + Math.floor(Math.random() * 9);
const TOKEN = "tok-stage2";
const BASE = `http://127.0.0.1:${PORT}`;
let srv: ChildProcess | undefined;
let ws: string;
let sid: string;

const H = () => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${TOKEN}`,
  ...(sid ? { "mcp-session-id": sid } : {}),
});
const parse = (t: string) => {
  const l = t.split("\n").find((x) => x.startsWith("data:"));
  return JSON.parse(l ? l.slice(5).trim() : t);
};
async function call(name: string, args: any) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }),
  });
  return parse(await r.text()).result;
}
const text = (res: any) => res.content[0].text as string;

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-s2-"));
  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      BRIDGE_MODE: "admin",
      BRIDGE_ADMIN_ACK: "I_UNDERSTAND_FULL_PC_ACCESS",
      BRIDGE_APPROVAL: "auto",
      BRIDGE_TOKEN: TOKEN,
      BRIDGE_PORT: String(PORT),
      BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com",
      BRIDGE_WORKSPACE: ws,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const init = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
  });
  sid = init.headers.get("mcp-session-id")!;
  await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
}, 25000);

afterAll(() => {
  srv?.kill();
  if (ws) rmSync(ws, { recursive: true, force: true });
});

describe("Etapa 2 (admin)", () => {
  it("get_policy mostra allowlist e modo admin", async () => {
    const p = JSON.parse(text(await call("get_policy", {})));
    expect(p.mode).toBe("admin");
    expect(p.allow).toContain("npm");
  });

  it("manage_allowlist adiciona binário; denylist é intocável", async () => {
    expect(text(await call("manage_allowlist", { action: "add", binary: "go" }))).toContain("add");
    const p = JSON.parse(text(await call("get_policy", {})));
    expect(p.allow).toContain("go");
    const denied = await call("manage_allowlist", { action: "add", binary: "rm" });
    expect(denied.isError).toBe(true);
  });

  it("set_env aplica variável ao run_command", async () => {
    await call("set_env", { name: "UAB_HELLO", value: "mundo42" });
    const out = text(await call("run_command", { command: 'node -e "process.stdout.write(String(process.env.UAB_HELLO))"', cwd: "." }));
    expect(out).toContain("mundo42");
  });

  it("read_media_file devolve base64 de um binário", async () => {
    await call("write_file", { path: "data.bin", content: "conteudo-bin" });
    const res = await call("read_media_file", { path: "data.bin" });
    const info = JSON.parse(text(res));
    expect(Buffer.from(info.base64, "base64").toString("utf8")).toBe("conteudo-bin");
  });

  it("watch detecta criação de arquivo", async () => {
    const started = text(await call("watch_start", { path: ".", recursive: true }));
    const idMatch = started.match(/watch_id="([a-f0-9]+)"/);
    expect(idMatch).toBeTruthy();
    const wid = idMatch![1];
    await call("write_file", { path: "novo.txt", content: "oi" });
    let events: any[] = [];
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      events = JSON.parse(text(await call("watch_poll", { watch_id: wid })));
      if (events.length) break;
    }
    await call("watch_stop", { watch_id: wid });
    expect(events.length).toBeGreaterThan(0);
  }, 10000);

  it("download_to_file bloqueia destino privado/loopback (SSRF)", async () => {
    const res = await call("download_to_file", { url: "http://127.0.0.1:1/x", dest: "x.bin" });
    expect(res.isError).toBe(true);
    expect(text(res).toLowerCase()).toContain("bloquead");
  });
});
