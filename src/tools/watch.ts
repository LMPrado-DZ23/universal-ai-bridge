import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { safeResolve, display } from "../security/paths.js";
import { ok, fail, type Ctx } from "./helpers.js";

/** Monitoramento de arquivos (read-only): sempre disponível. */
export function registerWatchTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;

  server.registerTool(
    "watch_start",
    {
      title: "Monitorar arquivos",
      description: "Começa a observar um arquivo ou pasta do workspace. Retorna um watch_id.",
      inputSchema: {
        path: z.string().default(".").describe("Caminho relativo ao workspace"),
        recursive: z.boolean().default(true),
      },
    },
    async ({ path, recursive }) => {
      try {
        const abs = safeResolve(ws, path);
        if (!existsSync(abs)) return fail(`Caminho não existe: ${path}`);
        if(ctx.config.auditRequired)ctx.audit.record({tool:"watch_start",decision:"allow",args:{}});
        const id = ctx.watcher.start(abs, display(ws, abs), recursive);
        ctx.audit.record({ tool: "watch_start", decision: "allow", args: { path } });
        return ok(`✔ Observando "${path}". watch_id="${id}". Use watch_poll para ver mudanças.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "watch_poll",
    {
      title: "Ver mudanças observadas",
      description: "Retorna e limpa os eventos acumulados de um watch (ou lista os watches se omitir watch_id).",
      inputSchema: { watch_id: z.string().optional() },
    },
    async ({ watch_id }) => {
      try {
        if (!watch_id) return ok(JSON.stringify(ctx.watcher.list(), null, 2));
        return ok(JSON.stringify(ctx.watcher.poll(watch_id), null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "watch_stop",
    {
      title: "Parar de monitorar",
      description: "Encerra um watch pelo watch_id.",
      inputSchema: { watch_id: z.string() },
    },
    async ({ watch_id }) => {
      try {
        if(ctx.config.auditRequired)ctx.audit.record({tool:"watch_stop",decision:"allow",args:{}});
        ctx.watcher.stop(watch_id);
        ctx.audit.record({ tool: "watch_stop", decision: "executed", args: { watch_id } });
        return ok(`✔ Watch ${watch_id} encerrado.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
