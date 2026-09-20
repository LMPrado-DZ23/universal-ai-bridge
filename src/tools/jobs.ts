import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeResolve } from "../security/paths.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

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
        "Inicia um comando de longa duração e retorna um job_id imediatamente. Use job_output para " +
        "acompanhar a saída, job_write para stdin, job_cancel para parar. Sujeito a política e aprovação.",
      inputSchema: {
        command: z.string().describe("Comando único (sem encadeamento/redirecionamento)"),
        cwd: z.string().default(".").describe("Diretório relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ command, cwd, confirm_token }) => {
      const core = { command, cwd };
      try {
        const decision = ctx.policy.checkCommand(command);
        if (!decision.ok) {
          ctx.audit.record({ tool: "run_job", decision: "deny", args: core, detail: decision.reason });
          return fail(`Bloqueado pela política: ${decision.reason}`);
        }
        const workdir = safeResolve(ctx.config.workspace, cwd);
        const g = gate(ctx, "run_job", core, confirm_token);
        if (!g.proceed) return g.result;
        const id = ctx.jobs.start(command, workdir);
        ctx.audit.record({ tool: "run_job", decision: "executed", args: core, detail: `job=${id}` });
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
