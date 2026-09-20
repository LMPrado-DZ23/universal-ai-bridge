import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { safeResolve } from "../security/paths.js";
import { ok, fail, type Ctx } from "./helpers.js";

const MAX_TEXT = 200_000;

/** Aplica offset/limit de caracteres e sinaliza truncamento. */
function paginate(text: string, offset: number, limit: number | undefined): string {
  const start = Math.max(0, offset);
  const end = limit !== undefined ? start + limit : Math.min(text.length, start + MAX_TEXT);
  const slice = text.slice(start, end);
  const more = end < text.length;
  return more ? `${slice}\n\n… [truncado: ${text.length} chars no total; use offset=${end}]` : slice;
}

/** Leitura de documentos (read-only): sempre disponível. */
export function registerDocTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;
  const maxBytes = () => ctx.config.policy.files.maxReadBytes;

  function guard(path: string): string {
    const abs = safeResolve(ws, path);
    const st = statSync(abs);
    if (st.size > maxBytes()) throw new Error(`Arquivo muito grande (${st.size} > limite ${maxBytes()} bytes).`);
    return abs;
  }

  server.registerTool(
    "read_pdf",
    {
      title: "Ler PDF (texto)",
      description: "Extrai o texto de um PDF do workspace. Suporta paginação por offset/limit de caracteres.",
      inputSchema: {
        path: z.string(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).optional(),
      },
    },
    async ({ path, offset, limit }) => {
      try {
        const abs = guard(path);
        const parser = new PDFParse({ data: readFileSync(abs) });
        const result = await parser.getText();
        ctx.audit.record({ tool: "read_pdf", decision: "allow", args: { path } });
        return ok(paginate(result.text ?? "", offset, limit));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "read_docx",
    {
      title: "Ler DOCX (texto)",
      description: "Extrai o texto de um arquivo .docx do workspace. Paginação por offset/limit de caracteres.",
      inputSchema: {
        path: z.string(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).optional(),
      },
    },
    async ({ path, offset, limit }) => {
      try {
        const abs = guard(path);
        const { value } = await mammoth.extractRawText({ buffer: readFileSync(abs) });
        ctx.audit.record({ tool: "read_docx", decision: "allow", args: { path } });
        return ok(paginate(value ?? "", offset, limit));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "read_sheet",
    {
      title: "Ler planilha (XLSX/CSV)",
      description: "Lê uma planilha .xlsx ou .csv do workspace e retorna as linhas como JSON. Paginação por offset/max_rows.",
      inputSchema: {
        path: z.string(),
        sheet: z.string().optional().describe("Nome da aba (XLSX); padrão: a primeira"),
        offset: z.number().int().min(0).default(0),
        max_rows: z.number().int().min(1).max(5000).default(1000),
      },
    },
    async ({ path, sheet, offset, max_rows }) => {
      try {
        const abs = guard(path);
        const wb = new ExcelJS.Workbook();
        const isCsv = extname(abs).toLowerCase() === ".csv";
        if (isCsv) await wb.csv.readFile(abs);
        else await wb.xlsx.readFile(abs);
        const ws0 = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
        if (!ws0) return fail(`Aba não encontrada: ${sheet ?? "(primeira)"}`);

        const rows: unknown[][] = [];
        ws0.eachRow((row) => {
          // row.values é 1-indexado (índice 0 vazio); normaliza para array simples.
          const vals = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
          rows.push(vals);
        });
        const total = rows.length;
        const page = rows.slice(offset, offset + max_rows);
        ctx.audit.record({ tool: "read_sheet", decision: "allow", args: { path, sheet } });
        return ok(JSON.stringify({ sheet: ws0.name, total_rows: total, offset, rows: page }, null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
