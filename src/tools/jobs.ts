import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeResolve } from "../security/paths.js";
import { sanitizeCommand } from "../audit/log.js";
import { parseCommand } from "../exec.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/** Resolve program+args a partir de {program,args} ou do legado {command}. */
export function resolveProgArgs(
  program?: string,
  args?: string[],
  command?: string
): { program: string; args: string[] } {
  if (program !== undefined && program !== "") return { program, args: args ?? [] };
  if (command !== undefined && command !== "") return parseCommand(command);
  throw new Error("Informe 'program' (+ 'args') ou 'command'.");
}

/**
 * Ferramentas de jobs: processos longos, interativos (stdin), com saída
 * incremental (streaming via polling) e cancelamento (mata a árvore).
 * Disponíveis quando allowShell está ligado.
 */
export function registerJobTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowShell) return;

  server.registerTool(
    "run_job",
    {
      title: "Iniciar job (assíncrono)",
      description:
        "Inicia um comando de longa duração (sem shell) e retorna um job_id. Prefira program+args; " +
        "'command' é aceito por compatibilidade (parser restrito). job_output/job_write/job_cancel. Sujeito a política e aprovação.",
      inputSchema: {
        program: z.string().optional().describe("Nome do binário (ex.: 'npm'); resolvido pelo PATH"),
        args: z.array(z.string()).default([]).describe("Argumentos (não passam por shell)"),
        command: z.string().optional().describe("Legado: comando único; convertido por parser restrito"),
        cwd: z.string().default(".").describe("Diretório relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ program, args, command, cwd, confirm_token }) => {
      try {
        const pa = resolveProgArgs(program, args, command);
        const label = `${pa.program} ${pa.args.join(" ")}`.trim();
        const decision = ctx.policy.checkProgram(pa.program);
        if (!decision.ok) {
          ctx.audit.record({ tool: "run_job", decision: "deny", args: { cmd: sanitizeCommand(label), cwd }, detail: decision.reason });
          return fail(`Bloqueado pela política: ${decision.reason}`);
        }
        const workdir = safeResolve(ctx.config.workspace, cwd);
        const g = gate(ctx, "run_job", { program: pa.program, args: pa.args, cwd }, confirm_token);
        if (!g.proceed) return g.result;
        const id = ctx.jobs.start(pa.program, pa.args, workdir, ctx.sessionEnv);
        ctx.audit.record({ tool: "run_job", decision: "executed", args: { cmd: sanitizeCommand(label), cwd }, detail: `job=${id}` });
        return ok(`✔ Job iniciado: ${id}\nUse job_output com job_id="${id}" para acompanhar.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "job_status",
    {
      title: "Status de um job (ou todos)",
      description: "Mostra estado de um job pelo job_id, ou lista todos se job_id for omitido.",
      inputSchema: { job_id: z.string().optional() },
    },
    async ({ job_id }) => {
      try {
        const data = job_id ? ctx.jobs.view(job_id) : ctx.jobs.list();
        return ok(JSON.stringify(data, null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "job_output",
    {
      title: "Saída incremental de um job",
      description:
        "Retorna a saída nova desde os cursores dados. Chame repetidamente passando os cursores retornados para 'streamar' a saída.",
      inputSchema: {
        job_id: z.string(),
        since_stdout: z.number().default(0).describe("Cursor de stdout (use o nextStdoutCursor anterior)"),
        since_stderr: z.number().default(0).describe("Cursor de stderr (use o nextStderrCursor anterior)"),
      },
    },
    async ({ job_id, since_stdout, since_stderr }) => {
      try {
        return ok(JSON.stringify(ctx.jobs.output(job_id, since_stdout, since_stderr), null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "job_write",
    {
      title: "Escrever no stdin do job",
      description: "Envia texto para o stdin de um job em execução (para processos interativos). Adicione \\n se precisar de Enter.",
      inputSchema: { job_id: z.string(), input: z.string() },
    },
    async ({ job_id, input }) => {
      try {
        ctx.jobs.write(job_id, input);
        ctx.audit.record({ tool: "job_write", decision: "executed", args: { job_id, bytes: input.length } });
        return ok(`✔ Enviado ao stdin de ${job_id} (${input.length} chars)`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "job_cancel",
    {
      title: "Cancelar job",
      description: "Encerra um job e toda a sua árvore de processos-filho.",
      inputSchema: { job_id: z.string() },
    },
    async ({ job_id }) => {
      try {
        ctx.jobs.cancel(job_id);
        ctx.audit.record({ tool: "job_cancel", decision: "executed", args: { job_id } });
        return ok(`✔ Job ${job_id} cancelado (árvore de processos encerrada).`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
