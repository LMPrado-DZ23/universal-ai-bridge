import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { safeResolve, display } from "../security/paths.js";
import { sanitizeUrl } from "../audit/log.js";
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
    // Only globally routable IPv6 unicast. This also blocks hexadecimal
    // mapped IPv4, NAT64, link-local variants and transition ranges.
    if (!isIP(ip) || !/^[23][0-9a-f]{3}:/.test(ip)) return true;
    if (/^2001:(?:0:|db8:|2:|10:|20:)/.test(ip) || ip.startsWith('2002:') || ip.startsWith('3fff:')) return true;
    if (ip === "::1" || ip === "::") return true;
    if (ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd")) return true; // link-local + ULA
    if (ip.startsWith("ff")) return true; // multicast
    return false;
  }
  // IPv4
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m || !isIP(ip)) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 127 || a === 10) return true; // "this", loopback, RFC1918
  if (a === 169 && b === 254) return true; // link-local
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a===192 && (b===0 || b===88)) return true;
  if (a===198 && (b===18 || b===19 || b===51)) return true;
  if (a===203 && b===0) return true;
  if (a >= 224) return true; // multicast / reservado
  return false;
}

export async function downloadPublic(url: string, max: number, signal: AbortSignal): Promise<Buffer> {
  let current = new URL(url);
  for(let hop=0;hop<=MAX_REDIRECTS;hop++) {
    signal.throwIfAborted();
    if(!['http:','https:'].includes(current.protocol) || current.username || current.password) throw new Error('URL/protocolo/credenciais bloqueados.');
    const hostname=current.hostname.replace(/^\[|\]$/g,'');
    const addresses = await new Promise<LookupAddress[]>((resolve,reject)=>{
      const abort=()=>reject(new Error('Download cancelado ou tempo limite excedido.'));
      signal.addEventListener('abort',abort,{once:true});
      lookup(hostname,{all:true}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
    signal.throwIfAborted();
    if(!addresses.length || addresses.some(a=>isPrivateIp(a.address)))throw new Error('Destino privado/loopback bloqueado.');
    const address=addresses[0];
    // Connect to the exact address just validated; Host and TLS SNI retain original hostname.
    const response=await new Promise<{status:number;location?:string;body:Buffer}>((resolve,reject)=>{
      const request=current.protocol==='https:'?httpsRequest:httpRequest;
      const req=request({protocol:current.protocol,hostname:address.address,port:current.port||undefined,
        path:current.pathname+current.search,method:'GET',headers:{Host:current.host,'Accept-Encoding':'identity'},
        ...(current.protocol==='https:' && !isIP(hostname) ? {servername:hostname} : {}),signal,
      },res=>{
        const status=res.statusCode ?? 0;
        if(status>=300 && status<400 && res.headers.location){res.destroy();resolve({status,location:res.headers.location,body:Buffer.alloc(0)});return;}
        if(status<200 || status>=300){res.destroy();reject(new Error(`HTTP ${status} ao baixar.`));return;}
        const chunks:Buffer[]=[];let bytes=0;
        res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>max){res.destroy(new Error('Download excede limite de bytes.'));return;}chunks.push(chunk);});
        res.once('error',reject);
        res.once('end',()=>resolve({status,body:Buffer.concat(chunks)}));
      });
      req.once('error',reject);req.end();
    });
    if(!response.location)return response.body;
    current=new URL(response.location,current);
  }
  throw new Error('Excesso de redirects.');
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

        const deadline = AbortSignal.timeout(TIMEOUT_MS);
        const signal = ctx.signal ? AbortSignal.any([deadline,ctx.signal]) : deadline;
        const buf = await downloadPublic(url,max,signal);
        mkdirSync(dirname(abs), { recursive: true });
        if(ctx.isDisposed?.())return fail("Sessão encerrada.");
        safeResolve(ctx.config.workspace,dest);
        writeFileSync(abs, buf);
        ctx.audit.record({ tool: "download_to_file", decision: "executed", args: { url: sanitizeUrl(url), dest }, detail: `${buf.length} bytes; ext=${extname(dest)}` });
        return ok(`✔ Baixado ${buf.length} bytes → ${display(ctx.config.workspace, abs)}`);
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Timeout no download." : String((e as Error).message);
        ctx.audit.record({ tool: "download_to_file", decision: "error", args: { url: sanitizeUrl(url), dest }, detail: msg });
        return fail(msg);
      }
    }
  );
}
