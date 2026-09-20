import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { safeResolve, display } from "../security/paths.js";
import { sanitizeArgs } from "../audit/log.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

export function registerFileTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;

  server.registerTool(
    "get_workspace_info",
    {
      title: "Informações do workspace",
      description:
        "Retorna raiz do workspace, modo (safe/admin), aprovação e se shell/docker estão habilitados. Chame primeiro.",
      inputSchema: {},
    },
    async () => {
      ctx.audit.record({ tool: "get_workspace_info", decision: "allow", args: {} });
      return ok(
        JSON.stringify(
          {
            workspace: ws,
            mode: ctx.config.mode,
            approval: ctx.config.approval,
            shell_enabled: ctx.config.allowShell,
            docker_enabled: ctx.config.allowDocker,
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
        const all = readdirSync(abs, { withFileTypes: true });
        const cap = ctx.config.policy.files.listMaxEntries;
        const entries = all.slice(0, cap).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        }));
        ctx.audit.record({ tool: "list_dir", decision: "allow", args: { path } });
        const note = all.length > cap ? `\n… lista truncada em ${cap} de ${all.length} itens` : "";
        return ok(JSON.stringify(entries, null, 2) + note);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "read_file",
    {
      title: "Ler arquivo",
      description:
        "Lê um arquivo de texto do workspace. Suporta leitura parcial: offset_lines/limit_lines " +
        "(fatia) ou tail_lines (últimas N linhas) para arquivos grandes.",
      inputSchema: {
        path: z.string().describe("Caminho relativo ao workspace"),
        offset_lines: z.number().int().min(0).optional().describe("Linha inicial (0-based)"),
        limit_lines: z.number().int().min(1).optional().describe("Máximo de linhas a partir de offset_lines"),
        tail_lines: z.number().int().min(1).optional().describe("Retorna as últimas N linhas"),
      },
    },
    async ({ path, offset_lines, limit_lines, tail_lines }) => {
      try {
        const abs = safeResolve(ws, path);
        const st = statSync(abs);
        const max = ctx.config.policy.files.maxReadBytes;
        const partial = tail_lines !== undefined || offset_lines !== undefined || limit_lines !== undefined;
        if (st.size > max && !partial) {
          return fail(`Arquivo muito grande (${st.size} > limite ${max} bytes). Use tail_lines ou offset_lines/limit_lines.`);
        }
        if (st.size > max * 8) {
          return fail(`Arquivo grande demais para ler em memória (${st.size} bytes).`);
        }
        let text = readFileSync(abs, "utf8");
        if (partial) {
          const lines = text.split(/\r?\n/);
          let slice: string[];
          if (tail_lines !== undefined) {
            slice = lines.slice(Math.max(0, lines.length - tail_lines));
          } else {
            const start = offset_lines ?? 0;
            const end = limit_lines !== undefined ? start + limit_lines : lines.length;
            slice = lines.slice(start, end);
          }
          text = slice.join("\n");
        }
        ctx.audit.record({ tool: "read_file", decision: "allow", args: { path } });
        return ok(text);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "read_multiple_files",
    {
      title: "Ler vários arquivos",
      description: "Lê vários arquivos de texto do workspace de uma vez.",
      inputSchema: { paths: z.array(z.string()).describe("Caminhos relativos ao workspace") },
    },
    async ({ paths }) => {
      const max = ctx.config.policy.files.maxReadBytes;
      const parts: string[] = [];
      for (const p of paths) {
        try {
          const abs = safeResolve(ws, p);
          const st = statSync(abs);
          if (st.size > max) parts.push(`===== ${p} =====\n[pulado: ${st.size} bytes > limite]`);
          else parts.push(`===== ${p} =====\n${readFileSync(abs, "utf8")}`);
        } catch (e) {
          parts.push(`===== ${p} =====\n[erro: ${(e as Error).message}]`);
        }
      }
      ctx.audit.record({ tool: "read_multiple_files", decision: "allow", args: { count: paths.length } });
      return ok(parts.join("\n\n"));
    }
  );

  server.registerTool(
    "get_file_info",
    {
      title: "Info de arquivo/pasta",
      description: "Metadados de um caminho: tipo, tamanho, datas de criação/modificação.",
      inputSchema: { path: z.string().describe("Caminho relativo ao workspace") },
    },
    async ({ path }) => {
      try {
        const abs = safeResolve(ws, path);
        const st = statSync(abs);
        return ok(
          JSON.stringify(
            {
              path,
              type: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other",
              size: st.size,
              created: st.birthtime.toISOString(),
              modified: st.mtime.toISOString(),
              accessed: st.atime.toISOString(),
            },
            null,
            2
          )
        );
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );

  server.registerTool(
    "write_file",
    {
      title: "Escrever arquivo",
      description:
        "Cria ou sobrescreve um arquivo de texto no workspace. Cria diretórios pais. Sujeito a política e aprovação.",
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
        old_text: z.string().describe("Trecho exato (ou regex, se is_regex) a substituir"),
        new_text: z.string().describe("Novo trecho"),
        replace_all: z.boolean().default(false).describe("Substituir todas as ocorrências"),
        is_regex: z.boolean().default(false).describe("Tratar old_text como expressão regular"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ path, old_text, new_text, replace_all, is_regex, confirm_token }) => {
      const core = { path, old_text, new_text, replace_all, is_regex };
      try {
        const abs = safeResolve(ws, path);
        if (!existsSync(abs)) return fail(`Arquivo não existe: ${path}`);
        const current = readFileSync(abs, "utf8");

        let next: string;
        let count = 0;
        if (is_regex) {
          let re: RegExp;
          try {
            re = new RegExp(old_text, replace_all ? "g" : "");
          } catch (err) {
            return fail(`Regex inválida: ${(err as Error).message}`);
          }
          count = (current.match(new RegExp(old_text, "g")) ?? []).length;
          if (count === 0) return fail("Nenhuma ocorrência da regex encontrada.");
          next = current.replace(re, new_text);
        } else {
          if (!current.includes(old_text)) return fail("old_text não encontrado no arquivo.");
          count = current.split(old_text).length - 1;
          next = replace_all ? current.split(old_text).join(new_text) : current.replace(old_text, new_text);
        }

        const decision = ctx.policy.checkWriteTarget(path, Buffer.byteLength(next));
        if (!decision.ok) return fail(`Bloqueado pela política: ${decision.reason}`);
        const g = gate(ctx, "edit_file", core, confirm_token);
        if (!g.proceed) return g.result;
        writeFileSync(abs, next, "utf8");
        ctx.audit.record({ tool: "edit_file", decision: "executed", args: sanitizeArgs(core) });
        const applied = replace_all ? `${count} ocorrência(s)` : "1 ocorrência";
        return ok(`✔ Editado (${applied}): ${display(ws, abs)}`);
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
        "Cria uma pasta de projeto com múltiplos arquivos de uma vez. files = { 'caminho': 'conteúdo' }. Sujeito a aprovação.",
      inputSchema: {
        name: z.string().describe("Nome da pasta do projeto (dentro do workspace)"),
        files: z.record(z.string()).describe("Mapa caminho→conteúdo, relativo à pasta do projeto"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ name, files, confirm_token }) => {
      try {
        const projAbs = safeResolve(ws, name);
        for (const rel of Object.keys(files)) {
          safeResolve(ws, join(name, rel)); // valida cada caminho
          const dec = ctx.policy.checkWriteTarget(rel, Buffer.byteLength(files[rel]));
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
}
