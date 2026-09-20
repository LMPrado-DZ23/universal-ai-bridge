import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";
import { safeResolve, display } from "../security/paths.js";
import { sanitizeArgs } from "../audit/log.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/** Escrita de documentos (efeito colateral): sujeita a política e aprovação. */
export function registerDocWriteTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;

  server.registerTool(
    "write_sheet",
    {
      title: "Criar planilha (XLSX/CSV)",
      description: "Cria uma planilha .xlsx ou .csv (pela extensão) a partir de linhas (array de arrays). Sujeito a aprovação.",
      inputSchema: {
        path: z.string().describe("Destino .xlsx ou .csv, relativo ao workspace"),
        rows: z.array(z.array(z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()])).max(100)).max(5000).refine(v => Buffer.byteLength(JSON.stringify(v)) <= ctx.config.policy.files.maxWriteBytes, "Limite agregado de planilha excedido").describe("Linhas: array de arrays"),
        sheet: z.string().default("Sheet1"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ path, rows, sheet, confirm_token }) => {
      const core = { path, rows_count: rows.length, sheet };
      try {
        const abs = safeResolve(ws, path);
        const dec = ctx.policy.checkWriteTarget(path, 0);
        if (!dec.ok) return fail(`Bloqueado pela política: ${dec.reason}`);
        const g = gate(ctx, "write_sheet", { path, sheet, rows }, confirm_token);
        if (!g.proceed) return g.result;
        const wb = new ExcelJS.Workbook();
        const sh = wb.addWorksheet(sheet);
        for (const r of rows) sh.addRow(r);
        mkdirSync(dirname(abs), { recursive: true });
        const buf = Buffer.from(extname(abs).toLowerCase() === '.csv' ? await wb.csv.writeBuffer() : await wb.xlsx.writeBuffer());
        if (buf.length > ctx.config.policy.files.maxWriteBytes) return fail('Documento excede limite de escrita.');
        if (buf.length > ctx.config.policy.files.maxWriteBytes) return fail("Documento excede limite de escrita.");
        if(ctx.isDisposed?.())return fail("Sessão encerrada.");
        safeResolve(ws,path);
        writeFileSync(abs, buf);
        ctx.audit.record({ tool: "write_sheet", decision: "executed", args: core });
        return ok(`✔ Planilha escrita: ${display(ws, abs)} (${rows.length} linha(s))`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "write_docx",
    {
      title: "Criar DOCX",
      description: "Cria um .docx a partir de parágrafos (array de strings). Sujeito a aprovação.",
      inputSchema: {
        path: z.string().describe("Destino .docx, relativo ao workspace"),
        paragraphs: z.array(z.string().max(10000)).max(1000).refine(v => Buffer.byteLength(JSON.stringify(v)) <= ctx.config.policy.files.maxWriteBytes, "Limite agregado DOCX excedido").describe("Parágrafos do documento"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ path, paragraphs, confirm_token }) => {
      const core = { path, paragraphs_count: paragraphs.length };
      try {
        const abs = safeResolve(ws, path);
        const dec = ctx.policy.checkWriteTarget(path, 0);
        if (!dec.ok) return fail(`Bloqueado pela política: ${dec.reason}`);
        const g = gate(ctx, "write_docx", { path, paragraphs }, confirm_token);
        if (!g.proceed) return g.result;
        const doc = new Document({ sections: [{ children: paragraphs.map((t) => new Paragraph({ text: t })) }] });
        const buf = await Packer.toBuffer(doc);
        mkdirSync(dirname(abs), { recursive: true });
        if (buf.length > ctx.config.policy.files.maxWriteBytes) return fail("Documento excede limite de escrita.");
        if(ctx.isDisposed?.())return fail("Sessão encerrada.");
        safeResolve(ws,path);
        writeFileSync(abs, buf);
        ctx.audit.record({ tool: "write_docx", decision: "executed", args: core });
        return ok(`✔ DOCX escrito: ${display(ws, abs)} (${paragraphs.length} parágrafo(s))`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "write_pdf",
    {
      title: "Criar PDF",
      description: "Cria um .pdf simples a partir de texto (uma linha por parágrafo). Sujeito a aprovação.",
      inputSchema: {
        path: z.string().describe("Destino .pdf, relativo ao workspace"),
        text: z.string().max(200000).describe("Conteúdo do PDF"),
        font_size: z.number().int().min(6).max(72).default(12),
        confirm_token: z.string().optional(),
      },
    },
    async ({ path, text, font_size, confirm_token }) => {
      const core = { path, chars: text.length };
      try {
        const abs = safeResolve(ws, path);
        const dec = ctx.policy.checkWriteTarget(path, Buffer.byteLength(text));
        if (!dec.ok) return fail(`Bloqueado pela política: ${dec.reason}`);
        const g = gate(ctx, "write_pdf", { path, text, font_size }, confirm_token);
        if (!g.proceed) return g.result;
        mkdirSync(dirname(abs), { recursive: true });
        const buf: Buffer = await new Promise((resolve, reject) => {
          const doc = new PDFDocument();
          const chunks: Buffer[] = [];
          doc.on("data", (c: Buffer) => chunks.push(c));
          doc.on("end", () => resolve(Buffer.concat(chunks)));
          doc.on("error", reject);
          doc.fontSize(font_size).text(text);
          doc.end();
        });
        if (buf.length > ctx.config.policy.files.maxWriteBytes) return fail("Documento excede limite de escrita.");
        if(ctx.isDisposed?.())return fail("Sessão encerrada.");
        safeResolve(ws,path);
        writeFileSync(abs, buf);
        ctx.audit.record({ tool: "write_pdf", decision: "executed", args: sanitizeArgs(core) });
        return ok(`✔ PDF escrito: ${display(ws, abs)} (${buf.length} bytes)`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
