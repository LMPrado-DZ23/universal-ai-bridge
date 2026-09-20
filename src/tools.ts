import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Config } from "./config.js";
import { PolicyEngine } from "./policy/engine.js";
import { ConfirmStore } from "./confirm.js";
import { Audit, sanitizeArgs } from "./audit/log.js";
import { safeResolve, display } from "./security/paths.js";

interface Ctx {
  config: Config;
  policy: PolicyEngine;
  confirm: ConfirmStore;
  audit: Audit;
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/**
 * Portão de aprovação para ações com efeito colateral.
 * Retorna null se pode executar; caso contrário retorna a resposta a devolver.
 */
function gate(
  ctx: Ctx,
  tool: string,
  coreArgs: Record<string, unknown>,
  confirmToken: string | undefined
): { proceed: true } | { proceed: false; result: ReturnType<typeof ok> } {
  if (ctx.config.approval === "auto") return { proceed: true };

  if (!confirmToken) {
    const token = ctx.confirm.issue(tool, coreArgs);
    ctx.audit.record({ tool, decision: "confirm-required", args: sanitizeArgs(coreArgs) });
    return {
      proceed: false,
      result: ok(
        `⚠️ Confirmação necessária para "${tool}".\n` +
          `Ação: ${JSON.stringify(sanitizeArgs(coreArgs))}\n` +
          `Para executar, chame "${tool}" de novo com os MESMOS argumentos e confirm_token="${token}".`
      ),
    };
  }

  if (!ctx.confirm.consume(confirmToken, tool, coreArgs)) {
    return {
      proceed: false,
      result: fail("Token de confirmação inválido, expirado ou não corresponde à ação. Refaça sem confirm_token para obter um novo."),
    };
  }
  return { proceed: true };
}

export function registerTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;
  mkdirSync(ws, { recursive: true });

  // ── READ-ONLY ──────────────────────────────────────────────────────

  server.registerTool(
    "get_workspace_info",
    {
      title: "Informações do workspace",
      description:
        "Retorna a raiz do workspace, o modo de aprovação e se o shell está habilitado. Chame isto primeiro para se orientar.",
      inputSchema: {},
    },
    async () => {
      ctx.audit.record({ tool: "get_workspace_info", decision: "allow", args: {} });
      return ok(
        JSON.stringify(
          {
            workspace: ws,
            approval: ctx.config.approval,
            shell_enabled: ctx.config.allowShell,
            note: "Todos os caminhos são relativos a esta raiz. Você não pode sair dela.",
          },
          null,
          2
        )
      );
    }
  );

  server.registerTool(
    "list_dir",
    {
      title: "Listar diretório",
      description: "Lista arquivos e pastas de um diretório dentro do workspace.",
      inputSchema: { path: z.string().default(".").describe("Caminho relativo ao workspace") },
    },
    async ({ path }) => {
      try {
        const abs = safeResolve(ws, path);
        const entries = readdirSync(abs, { withFileTypes: true }).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        }));
        ctx.audit.record({ tool: "list_dir", decision: "allow", args: { path } });
        return ok(JSON.stringify(entries, null, 2));
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "read_file",
    {
      title: "Ler arquivo",
      description: "Lê o conteúdo de um arquivo de texto dentro do workspace.",
      inputSchema: { path: z.string().describe("Caminho relativo ao workspace") },
    },
    async ({ path }) => {
      try {
        const abs = safeResolve(ws, path);
        const text = readFileSync(abs, "utf8");
        ctx.audit.record({ tool: "read_file", decision: "allow", args: { path } });
        return ok(text);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  // ── SIDE EFFECTS (passam pelo portão de aprovação) ─────────────────

  server.registerTool(
    "write_file",
    {
      title: "Escrever arquivo",
      description:
        "Cria ou sobrescreve um arquivo de texto no workspace. Cria diretórios pais automaticamente. Sujeito a política e aprovação.",
      inputSchema: {
        path: z.string().describe("Caminho relativo ao workspace"),
        content: z.string().describe("Conteúdo completo do arquivo"),
        confirm_token: z.string().optional().describe("Token da etapa de confirmação"),
      },
    },
    async ({ path, content, confirm_token }) => {
      const core = { path, content };
      try {
        const abs = safeResolve(ws, path);
        const decision = ctx.policy.checkWriteTarget(path, Buffer.byteLength(content));
        if (!decision.ok) {
          ctx.audit.record({ tool: "write_file", decision: "deny", args: sanitizeArgs(core), detail: decision.reason });
          return fail(`Bloqueado pela política: ${decision.reason}`);
        }
        const g = gate(ctx, "write_file", core, confirm_token);
        if (!g.proceed) return g.result;

        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, "utf8");
        ctx.audit.record({ tool: "write_file", decision: "executed", args: sanitizeArgs(core) });
        return ok(`✔ Escrito: ${display(ws, abs)} (${Buffer.byteLength(content)} bytes)`);
      } catch (e) {
        ctx.audit.record({ tool: "write_file", decision: "error", args: sanitizeArgs(core), detail: String((e as Error).message) });
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "edit_file",
    {
      title: "Editar arquivo (substituição)",
      description:
        "Substitui a primeira ocorrência exata de old_text por new_text num arquivo existente. Sujeito a aprovação.",
      inputSchema: {
        path: z.string(),
        old_text: z.string().describe("Trecho exato a substituir"),
        new_text: z.string().describe("Novo trecho"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ path, old_text, new_text, confirm_token }) => {
      const core = { path, old_text, new_text };
      try {
        const abs = safeResolve(ws, path);
        if (!existsSync(abs)) return fail(`Arquivo não existe: ${path}`);
        const current = readFileSync(abs, "utf8");
        if (!current.includes(old_text)) return fail("old_text não encontrado no arquivo.");
        const next = current.replace(old_text, new_text);
        const decision = ctx.policy.checkWriteTarget(path, Buffer.byteLength(next));
        if (!decision.ok) return fail(`Bloqueado pela política: ${decision.reason}`);
        const g = gate(ctx, "edit_file", core, confirm_token);
        if (!g.proceed) return g.result;
        writeFileSync(abs, next, "utf8");
        ctx.audit.record({ tool: "edit_file", decision: "executed", args: sanitizeArgs(core) });
        return ok(`✔ Editado: ${display(ws, abs)}`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "make_dir",
    {
      title: "Criar diretório",
      description: "Cria um diretório (e pais) dentro do workspace.",
      inputSchema: { path: z.string(), confirm_token: z.string().optional() },
    },
    async ({ path, confirm_token }) => {
      const core = { path };
      try {
        const abs = safeResolve(ws, path);
        const g = gate(ctx, "make_dir", core, confirm_token);
        if (!g.proceed) return g.result;
        mkdirSync(abs, { recursive: true });
        ctx.audit.record({ tool: "make_dir", decision: "executed", args: core });
        return ok(`✔ Diretório criado: ${display(ws, abs)}`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "move_path",
    {
      title: "Mover / renomear",
      description: "Move ou renomeia um arquivo/pasta dentro do workspace. Sujeito a aprovação.",
      inputSchema: { from: z.string(), to: z.string(), confirm_token: z.string().optional() },
    },
    async ({ from, to, confirm_token }) => {
      const core = { from, to };
      try {
        const absFrom = safeResolve(ws, from);
        const absTo = safeResolve(ws, to);
        const g = gate(ctx, "move_path", core, confirm_token);
        if (!g.proceed) return g.result;
        mkdirSync(dirname(absTo), { recursive: true });
        renameSync(absFrom, absTo);
        ctx.audit.record({ tool: "move_path", decision: "executed", args: core });
        return ok(`✔ Movido: ${display(ws, absFrom)} → ${display(ws, absTo)}`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "create_project",
    {
      title: "Criar esqueleto de projeto",
      description:
        "Cria uma pasta de projeto com múltiplos arquivos de uma vez. Passe um objeto files { 'caminho/arquivo': 'conteúdo' }. Sujeito a aprovação.",
      inputSchema: {
        name: z.string().describe("Nome da pasta do projeto (dentro do workspace)"),
        files: z.record(z.string()).describe("Mapa caminho→conteúdo, relativo à pasta do projeto"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ name, files, confirm_token }) => {
      const core = { name, files };
      try {
        const projAbs = safeResolve(ws, name);
        for (const rel of Object.keys(files)) {
          const abs = safeResolve(ws, join(name, rel)); // valida cada caminho
          const dec = ctx.policy.checkWriteTarget(abs, Buffer.byteLength(files[rel]));
          if (!dec.ok) return fail(`Bloqueado (${rel}): ${dec.reason}`);
        }
        const g = gate(ctx, "create_project", { name, files: Object.keys(files) }, confirm_token);
        if (!g.proceed) return g.result;
        for (const [rel, content] of Object.entries(files)) {
          const abs = safeResolve(ws, join(name, rel));
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, content, "utf8");
        }
        ctx.audit.record({ tool: "create_project", decision: "executed", args: { name, files: Object.keys(files) } });
        return ok(`✔ Projeto "${name}" criado com ${Object.keys(files).length} arquivo(s) em ${display(ws, projAbs)}`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  // ── SHELL (opcional, allowlist + aprovação) ────────────────────────

  if (ctx.config.allowShell) {
    server.registerTool(
      "run_command",
      {
        title: "Rodar comando",
        description:
          "Executa UM comando (sem encadeamento) dentro do workspace. Só binários da allowlist em config/policy.json. Sujeito a aprovação.",
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
            ctx.audit.record({ tool: "run_command", decision: "deny", args: core, detail: decision.reason });
            return fail(`Bloqueado pela política: ${decision.reason}`);
          }
          const workdir = safeResolve(ws, cwd);
          const g = gate(ctx, "run_command", core, confirm_token);
          if (!g.proceed) return g.result;

          const [bin, ...args] = command.trim().split(/\s+/);
          const r = spawnSync(bin, args, {
            cwd: workdir,
            timeout: ctx.policy.shellTimeoutMs,
            maxBuffer: ctx.policy.shellMaxOutput,
            shell: true,
            encoding: "utf8",
          });
          ctx.audit.record({ tool: "run_command", decision: "executed", args: core, detail: `exit=${r.status}` });
          const out = [
            `exit code: ${r.status}`,
            r.stdout ? `--- stdout ---\n${r.stdout}` : "",
            r.stderr ? `--- stderr ---\n${r.stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          return ok(out || "(sem saída)");
        } catch (e) {
          ctx.audit.record({ tool: "run_command", decision: "error", args: core, detail: String((e as Error).message) });
          return fail(String((e as Error).message));
        }
      }
    );
  }
}
