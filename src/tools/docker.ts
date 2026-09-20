import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeResolve } from "../security/paths.js";
import { scanShellUnsafe } from "../policy/engine.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/**
 * Ferramenta docker: só existe no modo admin com BRIDGE_ALLOW_DOCKER=true.
 * Roda `docker <args>` como um job (builds/execuções são longos). Bloqueia
 * metacaracteres de shell. AVISO: acesso ao Docker do host ~ acesso root.
 */
export function registerDockerTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowDocker) return;

  server.registerTool(
    "docker",
    {
      title: "Docker (admin)",
      description:
        "Executa 'docker <args>' como um job (ex.: 'ps', 'build -t app .', 'compose up -d'). " +
        "Modo admin. Acompanhe com job_output. Sujeito a aprovação.",
      inputSchema: {
        args: z.string().describe("Argumentos do docker, ex.: 'ps -a' ou 'build -t app .'"),
        cwd: z.string().default(".").describe("Diretório relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ args, cwd, confirm_token }) => {
      const core = { args, cwd };
      try {
        const unsafe = scanShellUnsafe(`docker ${args}`);
        if (unsafe) return fail(`docker: ${unsafe}`);
        const workdir = safeResolve(ctx.config.workspace, cwd);
        const g = gate(ctx, "docker", core, confirm_token);
        if (!g.proceed) return g.result;
        const command = `docker ${args}`;
        const id = ctx.jobs.start(command, workdir);
        ctx.audit.record({ tool: "docker", decision: "executed", args: core, detail: `job=${id}` });
        return ok(`✔ docker iniciado como job ${id}\nUse job_output com job_id="${id}".`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
