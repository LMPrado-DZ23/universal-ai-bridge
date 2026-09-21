import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import ExcelJS from "exceljs";

const distEntry = resolve(__dirname, "..", "dist", "index.js");
const PORT = 8920 + Math.floor(Math.random() * 9);
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const BASE = `http://127.0.0.1:${PORT}`;
let srv: ChildProcess | undefined;
let ws: string;
let sid: string;
let serverErrors = "";
let serverExit: string | undefined;

const H = () => ({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}`, ...(sid ? { "mcp-session-id": sid } : {}) });
const parse = (t: string) => { const l = t.split("\n").find((x) => x.startsWith("data:")); return JSON.parse(l ? l.slice(5).trim() : t); };
async function call(name: string, args: any) {
  try {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }) });
  return parse(await r.text()).result;
  } catch (error) {
    await new Promise(r => setTimeout(r, 100));
    throw new Error(`Document test server exit=${serverExit ?? "running"}; stderr=${serverErrors}`, { cause: error });
  }
}
const txt = (res: any) => res.content[0].text as string;

/** Constrói um PDF mínimo e válido (xref correto) com o texto dado. */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

beforeAll(async () => {
  if (!existsSync(distEntry)) throw new Error("rode npm run build antes");
  ws = mkdtempSync(join(tmpdir(), "uab-docs-"));
  writeFileSync(join(ws, "dados.csv"), "nome,idade\nAna,30\nBia,25\n");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Plan1");
  sheet.addRow(["produto", "preco"]);
  sheet.addRow(["café", 12.5]);
  await wb.xlsx.writeFile(join(ws, "plan.xlsx"));
  writeFileSync(join(ws, "doc.pdf"), makePdf("Hello UAB PDF"));

  srv = spawn(process.execPath, [distEntry, "--transport", "http"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, BRIDGE_MODE: "safe", BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_DATA_DIR: ws, BRIDGE_ALLOWED_ORIGINS: "https://chatgpt.com", BRIDGE_WORKSPACE: ws },
    stdio: ["ignore", "ignore", "pipe"],
  });
  srv.stderr!.on("data", chunk => { serverErrors = (serverErrors + chunk.toString()).slice(-8000); });
  srv.on("exit", (code, signal) => { serverExit = `${code}/${signal}`; });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const init = await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  sid = init.headers.get("mcp-session-id")!;
  await fetch(`${BASE}/mcp`, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
}, 25000);

afterAll(() => { srv?.kill(); if (ws) rmSync(ws, { recursive: true, force: true }); });

describe("Fase 4 — documentos", () => {
  it("read_sheet lê CSV", async () => {
    const j = JSON.parse(txt(await call("read_sheet", { path: "dados.csv" })));
    expect(j.total_rows).toBe(3);
    expect(j.rows[1]).toEqual(["Ana", 30]);
  });

  it("read_sheet lê XLSX", async () => {
    const j = JSON.parse(txt(await call("read_sheet", { path: "plan.xlsx" })));
    expect(j.rows[0]).toEqual(["produto", "preco"]);
    expect(j.rows[1][0]).toBe("café");
  });

  it("read_pdf extrai texto de um PDF real", async () => {
    // Repeat to exercise native PDF parser startup/teardown, not only one successful read.
    for (let i = 0; i < 5; i++) {
    const res = await call("read_pdf", { path: "doc.pdf" });
    expect(res.isError).toBeFalsy();
    expect(txt(res)).toContain("Hello UAB PDF");
    }
  }, 60000);

  it("read_docx falha graciosamente em arquivo inválido", async () => {
    const res = await call("read_docx", { path: "dados.csv" });
    expect(res.isError).toBe(true); // .csv não é docx
  });
});
