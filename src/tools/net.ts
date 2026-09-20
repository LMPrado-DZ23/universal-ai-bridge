import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { lookup } from "node:dns/promises";
import { safeResolve, display } from "../security/paths.js";
import { ok, fail, gate, type Ctx } from "./helpers.js";

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30000;

/** true se o IP é loopback/privado/link-local/CGNAT/multicast/especial. */
export function isPrivateIp(ipRaw: string): boolean {
  let ip = ipRaw.trim().toLowerCase();
  // IPv6 com escopo (fe80::1%eth0) → tira o escopo.
  const pct = ip.indexOf("%");
  if (pct >= 0) ip = ip.slice(0, pct);
  // IPv4 mapeado em IPv6 (::ffff:127.0.0.1) → trata como IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];

  // IPv6
  if (ip.includes(":")) {
    if (ip === "::1" || ip === "::") return true;
    if (ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd")) return true; // link-local + ULA
    if (ip.startsWith("ff")) return true; // multicast
    return false;
  }
  // IPv4
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 127 || a === 10) return true; // "this", loopback, RFC1918
  if (a === 169 && b === 254) return true; // link-local
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reservado
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  // Resolve TODOS os endereços (A e AAAA) e bloqueia se qualquer um for privado.
  let addrs;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`Não foi possível resolver o host: ${hostname}`);
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error(`Destino privado/loopback bloqueado: ${hostname} → ${address}`);
    }
  }
}

/**
 * download_to_file: baixa uma URL http(s) publica para o workspace.
 * Só no modo admin, com aprovação. Segue redirects MANUALMENTE revalidando
 * cada salto (anti-SSRF), com timeout, teto de redirects e teto de bytes.
 */
export function registerNetTools(server: McpServer, ctx: Ctx): void {
  if (ctx.config.mode !== "admin") return;

  server.registerTool(
    "download_to_file",
    {
      title: "Baixar URL para arquivo (admin)",
      description:
        "Baixa uma URL http(s) publica para um arquivo no workspace. Revalida cada redirect e bloqueia IPs privados/loopback. Sujeito a aprovação.",
      inputSchema: {
        url: z.string().url(),
        dest: z.string().describe("Caminho de destino, relativo ao workspace"),
        confirm_token: z.string().optional(),
      },
    },
    async ({ url, dest, confirm_token }) => {
      const core = { url, dest };
      try {
        const abs = safeResolve(ctx.config.workspace, dest);
        const max = ctx.config.policy.files.maxWriteBytes;
        // Extensão do destino segue a mesma política do write_file.
        const extDec = ctx.policy.checkWriteTarget(dest, 0);
        if (!extDec.ok) return fail(`Bloqueado pela política: ${extDec.reason}`);

        const g = gate(ctx, "download_to_file", core, confirm_token);
        if (!g.proceed) return g.result;

        // Segue redirects manualmente, revalidando cada host.
        let current = url;
        let resp: Response | undefined;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
        try {
          for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const u = new URL(current);
            if (u.protocol !== "http:" && u.protocol !== "https:") return fail("Só http/https são permitidos.");
            await assertPublicHost(u.hostname);
            resp = await fetch(current, { redirect: "manual", signal: ac.signal });
            if (resp.status >= 300 && resp.status < 400) {
              const loc = resp.headers.get("location");
              if (!loc) break;
              current = new URL(loc, current).toString();
              if (hop === MAX_REDIRECTS) return fail("Excesso de redirects.");
              continue;
            }
            break;
          }
        } finally {
          clearTimeout(timer);
        }
        if (!resp) return fail("Sem resposta.");
        if (!resp.ok) return fail(`HTTP ${resp.status} ao baixar.`);

        // Lê com teto de bytes (sem arrayBuffer ilimitado).
        const chunks: Uint8Array[] = [];
        let total = 0;
        const reader = resp.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              total += value.length;
              if (total > max) {
                await reader.cancel();
                return fail(`Arquivo baixado excede o limite (${max} bytes).`);
              }
              chunks.push(value);
            }
          }
        }
        const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
        ctx.audit.record({ tool: "download_to_file", decision: "executed", args: core, detail: `${buf.length} bytes; ext=${extname(dest)}` });
        return ok(`✔ Baixado ${buf.length} bytes → ${display(ctx.config.workspace, abs)}`);
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Timeout no download." : String((e as Error).message);
        ctx.audit.record({ tool: "download_to_file", decision: "error", args: core, detail: msg });
        return fail(msg);
      }
    }
  );
}
