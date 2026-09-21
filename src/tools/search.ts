import { isolated } from "../isolate.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeResolve } from "../security/paths.js";
import { ok, fail, type Ctx } from "./helpers.js";

export function registerSearchTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;

  server.registerTool(
    "search_files",
    {
      title: "Buscar arquivos por nome",
      description: "Procura arquivos cujo nome contem o termo (recursivo, ignora .git/node_modules/dist, nao segue symlinks).",
      inputSchema: {
        query: z.string().min(1).max(512).describe("Substring do nome do arquivo (case-insensitive)"),
        path: z.string().default(".").describe("Diretorio base, relativo ao workspace"),
        max: z.number().int().min(1).max(1000).default(200),
      },
    },
    async ({ query, path, max }) => {
      try {
        const base = safeResolve(ws, path);
        const hits=await isolated<string[]>({kind:'names',base,workspace:ws,query,max},5000,ctx.signal);
        ctx.audit.record({ tool: "search_files", decision: "allow", args: { query, path } });
        return ok(hits.length ? hits.join("\n") : "(nenhum arquivo encontrado)");
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "search_content",
    {
      title: "Buscar dentro de arquivos (grep)",
      description:
        "Procura texto/regex dentro dos arquivos do workspace e retorna arquivo:linha: trecho. " +
        "Ignora .git/node_modules/dist, nao segue symlinks e pula binarios.",
      inputSchema: {
        query: z.string().min(1).max(512).describe("Texto ou regex a procurar"),
        path: z.string().default(".").describe("Diretorio base, relativo ao workspace"),
        is_regex: z.boolean().default(false),
        ignore_case: z.boolean().default(true),
        max: z.number().int().min(1).max(2000).default(300),
      },
    },
    async ({ query, path, is_regex, ignore_case, max }) => {
      try {
        const base = safeResolve(ws, path);
        const hits = await isolated<string[]>({kind: 'search', base, workspace: ws, query, regex: is_regex, ignoreCase: ignore_case, max, maxFileBytes: ctx.config.policy.files.maxReadBytes},5000,ctx.signal);
        ctx.audit.record({ tool: "search_content", decision: "allow", args: { query, path } });
        return ok(hits.length ? hits.join("\n") : "(nenhuma ocorrencia)");
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
