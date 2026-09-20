import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeResolve } from "../security/paths.js";
import { sanitizeCommand } from "../audit/log.js";
import { runStructuredSync } from "../exec.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";
import { resolveProgArgs } from "./jobs.js";

/**
 * run_command: comando síncrono e curto, SEM shell interpretado (spawn shell:false).
 * NÃO é sandbox — roda com os privilégios do processo. Só quando allowShell liga.
 */
export function registerShellTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowShell) return;

  server.registerTool(
    "run_command",
    {
      title: "Rodar comando (síncrono)",
      description:
        "Executa UM comando curto SEM shell (spawn direto) e espera terminar. Prefira program+args; " +
        "'command' é aceito por compatibilidade (parser restrito). Só binários da allowlist. Sujeito a aprovação.",
      inputSchema: {
        program: z.string().optional().describe("Nome do binário (ex.: 'npm'); resolvido pelo PATH"),
        args: z.array(z.string()).default([]).describe("Argumentos (não passam por shell)"),
        command: z.string().optional().describe("Legado: comando único; convertido por parser restrito"),
        cwd: z.string().default(".").describe("Diretório de trabalho, relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ program, args, command, cwd, confirm_token }) => {
      try {
        const pa = resolveProgArgs(program, args, command);
        const label = `${pa.program} ${pa.args.join(" ")}`.trim();
        const decision = ctx.policy.checkProgram(pa.program);
        if (!decision.ok) {
          ctx.audit.record({ tool: "run_command", decision: "deny", args: { cmd: sanitizeCommand(label), cwd }, detail: decision.reason });
          return fail(`Bloqueado pela política: ${decision.reason}`);
        }
        const workdir = safeResolve(ctx.config.workspace, cwd);
        const g = gate(ctx, "run_command", { program: pa.program, args: pa.args, cwd }, confirm_token);
        if (!g.proceed) return g.result;

        const r = runStructuredSync(pa.program, pa.args, {
          cwd: workdir,
          env: ctx.sessionEnv,
          timeout: ctx.policy.shellTimeoutMs,
          maxBuffer: ctx.policy.shellMaxOutput,
        });
        ctx.audit.record({ tool: "run_command", decision: "executed", args: { cmd: sanitizeCommand(label), cwd }, detail: `exit=${r.status}` });
        const out = [
          `exit code: ${r.status}`,
          r.stdout ? `--- stdout ---\n${r.stdout}` : "",
          r.stderr ? `--- stderr ---\n${r.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        return ok(out || "(sem saída)");
      } catch (e) {
        ctx.audit.record({ tool: "run_command", decision: "error", args: { cwd }, detail: String((e as Error).message) });
        return fail(String((e as Error).message));
      }
    }
  );
}
