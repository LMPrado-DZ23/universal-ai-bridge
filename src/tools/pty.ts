import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeResolve } from "../security/paths.js";
import { tokenize } from "../jobs.js";
import { loadPty } from "../pty.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/**
 * Terminal interativo REAL via PTY (apps full-screen: vim, htop, REPLs).
 * Só quando allowShell está ligado. Se @lydell/node-pty não estiver disponível
 * na plataforma, pty_start informa isso explicitamente (fallback: use run_job).
 */
export function registerPtyTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.config.allowShell) return;

  server.registerTool(
    "pty_start",
    {
      title: "Abrir terminal interativo (PTY)",
      description:
        "Inicia um programa num pseudo-terminal (para apps interativos/full-screen). Retorna pty_id. " +
        "Use pty_output/pty_write/pty_resize/pty_kill. Requer @lydell/node-pty. Sujeito a aprovação.",
      inputSchema: {
        command: z.string().describe("Comando único (ex.: 'python', 'node')"),
        cwd: z.string().default(".").describe("Diretório relativo ao workspace"),
        cols: z.number().int().min(20).max(500).default(120),
        rows: z.number().int().min(5).max(200).default(30),
        confirm_token: z.string().optional(),
      },
    },
    async ({ command, cwd, cols, rows, confirm_token }) => {
      const core = { command, cwd };
      try {
        const decision = ctx.policy.checkCommand(command);
        if (!decision.ok) return fail(`Bloqueado pela política: ${decision.reason}`);
        const loaded = await loadPty();
        if (!loaded.ok) return fail(loaded.error ?? "PTY indisponível.");
        const workdir = safeResolve(ctx.config.workspace, cwd);
        const g = gate(ctx, "pty_start", core, confirm_token);
        if (!g.proceed) return g.result;
        const [file, ...args] = tokenize(command);
        const id = ctx.pty.start(file, args, workdir, cols, rows, ctx.sessionEnv);
        ctx.audit.record({ tool: "pty_start", decision: "executed", args: core, detail: `pty=${id}` });
        return ok(`✔ PTY iniciado: ${id}. Use pty_output com pty_id="${id}".`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "pty_output",
    {
      title: "Saída incremental do PTY",
      description: "Retorna a saída (com ANSI) desde o cursor. Reenvie nextCursor para acompanhar.",
      inputSchema: { pty_id: z.string(), since: z.number().int().min(0).default(0) },
    },
    async ({ pty_id, since }) => {
      try {
        return ok(JSON.stringify(ctx.pty.output(pty_id, since), null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "pty_write",
    {
      title: "Escrever no PTY",
      description: "Envia texto (teclas) ao PTY. Ex.: 'ls\\n', ou '\\u0003' para Ctrl-C.",
      inputSchema: { pty_id: z.string(), data: z.string() },
    },
    async ({ pty_id, data }) => {
      try {
        ctx.pty.write(pty_id, data);
        return ok(`✔ Enviado ao PTY ${pty_id}.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "pty_resize",
    {
      title: "Redimensionar o PTY",
      description: "Ajusta colunas/linhas do terminal.",
      inputSchema: { pty_id: z.string(), cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(200) },
    },
    async ({ pty_id, cols, rows }) => {
      try {
        ctx.pty.resize(pty_id, cols, rows);
        return ok(`✔ Redimensionado para ${cols}x${rows}.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "pty_kill",
    {
      title: "Encerrar o PTY",
      description: "Encerra a sessão de PTY.",
      inputSchema: { pty_id: z.string() },
    },
    async ({ pty_id }) => {
      try {
        ctx.pty.kill(pty_id);
        ctx.audit.record({ tool: "pty_kill", decision: "executed", args: { pty_id } });
        return ok(`✔ PTY ${pty_id} encerrado.`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
