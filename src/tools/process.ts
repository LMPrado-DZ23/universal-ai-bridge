import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { killTree } from "../jobs.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

const IS_WIN = process.platform === "win32";

/**
 * Ferramentas de processos do sistema. Domínio de terminal → disponíveis
 * quando allowShell está ligado. kill_process passa por aprovação.
 */
export function registerProcessTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowShell) return;

  server.registerTool(
    "list_processes",
    {
      title: "Listar processos",
      description: "Lista processos do sistema (pid e nome). Opcionalmente filtra por substring do nome.",
      inputSchema: {
        filter: z.string().optional().describe("Substring do nome (case-insensitive)"),
        max: z.number().int().min(1).max(1000).default(200),
      },
    },
    async ({ filter, max }) => {
      try {
        const r = await ctx.jobs.run(IS_WIN ? 'tasklist' : 'ps', IS_WIN ? ['/fo','csv','/nh'] : ['-eo','pid,comm'], ctx.config.workspace, {}, 5000);
        if (r.status !== 0) return fail(`Falha ao listar processos: ${r.stderr || r.status}`);

        const rows: { pid: string; name: string }[] = [];
        for (const line of (r.stdout || "").split(/\r?\n/)) {
          if (!line.trim()) continue;
          if (IS_WIN) {
            const m = line.match(/^"([^"]*)","([^"]*)"/);
            if (m) rows.push({ name: m[1], pid: m[2] });
          } else {
            const m = line.trim().match(/^(\d+)\s+(.*)$/);
            if (m) rows.push({ pid: m[1], name: m[2] });
          }
        }
        const q = filter?.toLowerCase();
        const out = rows
          .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
          .slice(0, max);
        ctx.audit.record({ tool: "list_processes", decision: "allow", args: { filter } });
        return ok(JSON.stringify(out, null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "kill_process",
    {
      title: "Encerrar processo",
      description:
        "Encerra um processo pelo PID (e sua árvore). Por padrão só mata processos iniciados pelo bridge; " +
        "para um PID externo, exige modo admin + allow_external=true. Sujeito a aprovação.",
      inputSchema: {
        pid: z.number().int().positive(),
        allow_external: z.boolean().default(false).describe("Permitir matar PID que não é do bridge (só admin)"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ pid, allow_external, confirm_token }) => {
      const core = { pid, allow_external };
      try {
        const owned = ctx.jobs.ownsPid(pid);
        if (!owned) {
          if (ctx.config.mode !== "admin" || !allow_external) {
            ctx.audit.record({ tool: "kill_process", decision: "deny", args: core, detail: "PID externo" });
            return fail(
              `PID ${pid} não pertence ao bridge. Para matar um processo externo, use modo admin e allow_external=true.`
            );
          }
        }
        const g = gate(ctx, "kill_process", core, confirm_token);
        if (!g.proceed) return g.result;
        killTree(pid);
        ctx.audit.record({ tool: "kill_process", decision: "executed", args: core });
        return ok(`✔ Processo ${pid} (e árvore) encerrado.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
