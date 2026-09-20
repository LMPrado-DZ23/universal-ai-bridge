import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8910 + Math.floor(Math.random() * 9);
const TOKEN = "docwrite-token-0123456789ab";
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

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-dw-"));
  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, BRIDGE_MODE: "safe", BRIDGE_APPROVAL: "auto", BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_DATA_DIR: ws, BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com", BRIDGE_WORKSPACE: ws },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const init = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  sid = init.headers.get("mcp-session-id")!;
  await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
}, 25000);

afterAll(() => { srv?.kill(); if (ws) rmSync(ws, { recursive: true, force: true }); });

describe("Fase 4b — escrita de documentos (round-trip)", () => {
  it("write_sheet -> read_sheet", async () => {
    const w = await call("write_sheet", { path: "out.xlsx", rows: [["a", "b"], [1, 2]], sheet: "S1" });
    expect(w.isError).toBeFalsy();
    const j = JSON.parse(txt(await call("read_sheet", { path: "out.xlsx" })));
    expect(j.rows[0]).toEqual(["a", "b"]);
    expect(j.rows[1]).toEqual([1, 2]);
  });

  it("write_docx -> read_docx", async () => {
    const w = await call("write_docx", { path: "out.docx", paragraphs: ["Linha um", "Linha dois"] });
    expect(w.isError).toBeFalsy();
    expect(txt(await call("read_docx", { path: "out.docx" }))).toContain("Linha um");
  });

  it("write_pdf -> read_pdf", async () => {
    const w = await call("write_pdf", { path: "out.pdf", text: "PDF conteudo teste" });
    expect(w.isError).toBeFalsy();
    expect(txt(await call("read_pdf", { path: "out.pdf" }))).toContain("PDF conteudo teste");
  });
});
