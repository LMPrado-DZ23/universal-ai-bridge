import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Testa search_files/search_content/read parcial via HTTP real (modo safe).
const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8990 + Math.floor(Math.random() * 9);
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
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
  return parse(await r.text()).result.content[0].text as string;
}

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-ws-"));
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src", "alpha.ts"), "export const A = 1;\n// TODO: revisar\nconst x = 2;\n");
  writeFileSync(join(ws, "src", "beta.js"), "console.log('hello');\n");
  writeFileSync(join(ws, "big.txt"), Array.from({ length: 50 }, (_, i) => `linha ${i + 1}`).join("\n"));

  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, BRIDGE_MODE: "safe", BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com", BRIDGE_WORKSPACE: ws },
    stdio: "ignore",
  });
  // health
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

describe("superset: busca e leitura", () => {
  it("search_files acha por nome", async () => {
    const out = await call("search_files", { query: "alpha" });
    expect(out).toContain("src/alpha.ts");
    expect(out).not.toContain("beta.js");
  });

  it("search_content acha TODO", async () => {
    const out = await call("search_content", { query: "TODO" });
    expect(out).toContain("src/alpha.ts:2:");
  });

  it("read_file com tail_lines", async () => {
    const out = await call("read_file", { path: "big.txt", tail_lines: 3 });
    expect(out.trim()).toBe("linha 48\nlinha 49\nlinha 50");
  });

  it("read_file com offset/limit", async () => {
    const out = await call("read_file", { path: "big.txt", offset_lines: 0, limit_lines: 2 });
    expect(out).toBe("linha 1\nlinha 2");
  });

  it("get_file_info retorna tipo e tamanho", async () => {
    const out = await call("get_file_info", { path: "src/beta.js" });
    const info = JSON.parse(out);
    expect(info.type).toBe("file");
    expect(info.size).toBeGreaterThan(0);
  });

  it("search_content NÃO lê symlink apontando para fora do workspace (C3)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "uab-out-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "SEGREDO_EXTERNO_XYZ");
    let linked = true;
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));
    } catch {
      linked = false; // sem privilégio de symlink (Windows sem dev mode)
    }
    if (!linked) {
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    const out = await call("search_content", { query: "SEGREDO_EXTERNO_XYZ" });
    expect(out).not.toContain("SEGREDO_EXTERNO_XYZ");
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
