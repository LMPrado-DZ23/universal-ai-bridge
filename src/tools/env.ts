import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, type Ctx } from "./helpers.js";

/**
 * Variáveis de ambiente por sessão, aplicadas a run_command/run_job.
 * Domínio de terminal → só quando allowShell está ligado.
 */
export function registerEnvTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowShell) return;

  server.registerTool(
    "set_env",
    {
      title: "Definir variável de ambiente da sessão",
      description: "Define uma variável de ambiente aplicada aos próximos run_command/run_job.",
      inputSchema: { name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Nome inválido"), value: z.string() },
    },
    async ({ name, value }) => {
      ctx.sessionEnv[name] = value;
      ctx.audit.record({ tool: "set_env", decision: "executed", args: { name } });
      return ok(`✔ ${name} definido para a sessão.`);
    }
  );

  server.registerTool(
    "unset_env",
    {
      title: "Remover variável da sessão",
      description: "Remove uma variável de ambiente da sessão.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      delete ctx.sessionEnv[name];
      return ok(`✔ ${name} removido.`);
    }
  );

  server.registerTool(
    "list_env",
    {
      title: "Listar variáveis da sessão",
      description: "Lista as variáveis de ambiente definidas nesta sessão (valores mascarados).",
      inputSchema: {},
    },
    async () => {
      const masked = Object.fromEntries(
        Object.entries(ctx.sessionEnv).map(([k, v]) => [k, v.length > 4 ? v.slice(0, 2) + "…" : "…"])
      );
      return ok(JSON.stringify(masked, null, 2));
    }
  );
}
