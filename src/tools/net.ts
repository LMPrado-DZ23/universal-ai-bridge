import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { lookup } from "node:dns/promises";
import { safeResolve, display } from "../security/paths.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

/** true se o IP é loopback/privado/link-local (bloqueia SSRF). */
function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * download_to_file: baixa uma URL http(s) para dentro do workspace.
 * Só no modo admin, com aprovação, e bloqueando destinos privados/loopback.
 */
export function registerNetTools(server: McpServer, ctx: Ctx): void {
  if (ctx.config.mode !== "admin") return;

  server.registerTool(
    "download_to_file",
    {
      title: "Baixar URL para arquivo (admin)",
      description:
        "Baixa uma URL http(s) pública para um arquivo dentro do workspace. Bloqueia IPs privados/loopback. Sujeito a aprovação.",
      inputSchema: {
        url: z.string().url(),
        dest: z.string().describe("Caminho de destino, relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ url, dest, confirm_token }) => {
      const core = { url, dest };
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return fail("Só http/https são permitidos.");
        const { address } = await lookup(u.hostname);
        if (isPrivateIp(address)) return fail(`Destino privado/loopback bloqueado: ${u.hostname} → ${address}`);

        const abs = safeResolve(ctx.config.workspace, dest);
        const g = gate(ctx, "download_to_file", core, confirm_token);
        if (!g.proceed) return g.result;

        const resp = await fetch(url, { redirect: "follow" });
        if (!resp.ok) return fail(`HTTP ${resp.status} ao baixar.`);
        const buf = Buffer.from(await resp.arrayBuffer());
        const max = ctx.config.policy.files.maxWriteBytes;
        if (buf.length > max) return fail(`Arquivo baixado grande demais (${buf.length} > ${max} bytes).`);

        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
        ctx.audit.record({ tool: "download_to_file", decision: "executed", args: core, detail: `${buf.length} bytes` });
        return ok(`✔ Baixado ${buf.length} bytes → ${display(ctx.config.workspace, abs)}`);
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
