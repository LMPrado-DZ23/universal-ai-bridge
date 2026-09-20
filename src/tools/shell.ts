import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawnSync } from "node:child_process";
import { safeResolve } from "../security/paths.js";
import { sanitizeCommand } from "../audit/log.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/**
 * run_command: comando síncrono e curto. NÃO é uma sandbox — roda com os
 * privilégios do processo. Só disponível quando allowShell está ligado.
 */
export function registerShellTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowShell) return;

  server.registerTool(
    "run_command",
    {
      title: "Rodar comando (síncrono)",
      description:
        "Executa UM comando curto (sem encadeamento/redirecionamento) no workspace e espera terminar. " +
        "Só binários da allowlist (config/policy.json). Para tarefas longas/interativas use run_job. Sujeito a aprovação.",
      inputSchema: {
        command: z.string().describe("Comando único, ex: 'npm install' ou 'python main.py'"),
        cwd: z.string().default(".").describe("Diretório de trabalho, relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ command, cwd, confirm_token }) => {
      const core = { command, cwd };
      try {
        const decision = ctx.policy.checkCommand(command);
        if (!decision.ok) {
          ctx.audit.record({ tool: "run_command", decision: "deny", args: { cmd: sanitizeCommand(command), cwd }, detail: decision.reason });
          return fail(`Bloqueado pela política: ${decision.reason}`);
        }
        const workdir = safeResolve(ctx.config.workspace, cwd);
        const g = gate(ctx, "run_command", core, confirm_token);
        if (!g.proceed) return g.result;

        const r = spawnSync(command, {
          cwd: workdir,
          timeout: ctx.policy.shellTimeoutMs,
          maxBuffer: ctx.policy.shellMaxOutput,
          shell: true,
          windowsHide: true,
          encoding: "utf8",
          env: { ...process.env, ...ctx.sessionEnv },
        });
        ctx.audit.record({ tool: "run_command", decision: "executed", args: { cmd: sanitizeCommand(command), cwd }, detail: `exit=${r.status}` });
        const out = [
          `exit code: ${r.status}`,
          r.stdout ? `--- stdout ---\n${r.stdout}` : "",
          r.stderr ? `--- stderr ---\n${r.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        return ok(out || "(sem saída)");
      } catch (e) {
        ctx.audit.record({ tool: "run_command", decision: "error", args: { cmd: sanitizeCommand(command), cwd }, detail: String((e as Error).message) });
        return fail(String((e as Error).message));
      }
    }
  );
}
