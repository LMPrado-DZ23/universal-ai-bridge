import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/**
 * Inspeção e gestão da política em runtime.
 * - get_policy: sempre disponível (leitura).
 * - manage_allowlist: só no modo admin, e com aprovação (muda o que pode rodar).
 *   As mudanças valem só em memória (não persistem); a denylist nunca é violada.
 */
export function registerPolicyTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "get_policy",
    {
      title: "Ver política",
      description: "Mostra allowlist, denylist e padrões bloqueados de comandos, e o modo atual.",
      inputSchema: {},
    },
    async () => {
      const snap = ctx.policy.snapshot();
      return ok(JSON.stringify({ mode: ctx.config.mode, shell_enabled: ctx.config.allowShell, ...snap }, null, 2));
    }
  );

  if (ctx.config.mode !== "admin") return;

  server.registerTool(
    "manage_allowlist",
    {
      title: "Gerenciar allowlist (admin)",
      description:
        "Adiciona ou remove um binário da allowlist de comandos em runtime (só admin). Nunca libera itens da denylist. Sujeito a aprovação.",
      inputSchema: {
        action: z.enum(["add", "remove"]),
        binary: z.string().describe("Nome do binário, ex.: 'go', 'cargo'"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ action, binary, confirm_token }) => {
      const core = { action, binary };
      const g = gate(ctx, "manage_allowlist", core, confirm_token);
      if (!g.proceed) return g.result;
      const res = action === "add" ? ctx.policy.addAllow(binary) : ctx.policy.removeAllow(binary);
      if (!res.ok) return fail(res.reason ?? "Falhou.");
      ctx.audit.record({ tool: "manage_allowlist", decision: "executed", args: core });
      return ok(`✔ allowlist: ${action} "${binary}".`);
    }
  );
}
