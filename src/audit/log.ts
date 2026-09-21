import { makePrivate } from "../security/private-file.js";
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/** Hash curto para correlacionar sem revelar o conteúdo. */
export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export interface AuditEntry {
  ts: string;
  tool: string;
  decision: "allow" | "deny" | "confirm-required" | "executed" | "error";
  args: Record<string, unknown>;
  detail?: string;
}

/**
 * Audit log append-only em JSONL, um arquivo por dia.
 * Nunca registra conteúdo de arquivo integral nem segredos — só metadados.
 */
export class Audit {
  constructor(private dir: string, private required = false) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  record(entry: Omit<AuditEntry, "ts">): void {
    try {
      const day = new Date().toISOString().slice(0,10);
      const files = readdirSync(this.dir).filter(f => /^audit-.*\.jsonl$/.test(f)).sort();
      // At most 8 files of 1 MB, and at most seven days.
      for (const name of files) if (Date.now()-statSync(resolve(this.dir,name)).mtimeMs > 7*86400000) unlinkSync(resolve(this.dir,name));
      let file=resolve(this.dir,`audit-${day}.jsonl`);
      if (existsSync(file) && statSync(file).size >= 1_000_000) renameSync(file,resolve(this.dir,`audit-${day}-${Date.now()}.jsonl`));
      const retained=readdirSync(this.dir).filter(f=>/^audit-.*\.jsonl$/.test(f)).sort((a,b)=>statSync(resolve(this.dir,a)).mtimeMs-statSync(resolve(this.dir,b)).mtimeMs);
      while(retained.length>=8) unlinkSync(resolve(this.dir,retained.shift()!));
      if(!existsSync(file))writeFileSync(file,'',{mode:0o600});
      makePrivate(file);
      const tool = /^[a-z_]{1,64}$/.test(entry.tool) ? entry.tool : 'invalid';
      const line=JSON.stringify({ts:new Date().toISOString(),tool,decision:entry.decision,args:sanitizeArgs(entry.args),detail:entry.detail ? {len:entry.detail.length,sha:shortHash(entry.detail)} : undefined});
      appendFileSync(file,line+'\n','utf8');
    } catch {
      if(this.required)throw new Error('Auditoria obrigatória indisponível; ação bloqueada.');
      process.stderr.write('[audit] Não foi possível registrar evento.\n');
    }
  }
}

/** Reduz args a metadados seguros. NUNCA registra o conteúdo bruto de strings. */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  // Hash whole nested values, including attacker-controlled record keys.
  const out: Record<string, unknown> = {};
  for (const [k,v] of Object.entries(args).slice(0,64)) {
    const key = /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(k) ? k : `field_${shortHash(k)}`;
    if(typeof v === 'number' || typeof v === 'boolean' || v == null) out[key]=v;
    else { const text=typeof v === 'string' ? v : JSON.stringify(v); out[key]={len:text.length,sha:shortHash(text)}; }
  }
  return out;
}

/** Metadados de um comando sem revelar o comando/segredos. */
export function sanitizeCommand(command: string): Record<string, unknown> {
  const trimmed = command.trim();
  const parts = trimmed.length ? trimmed.split(/\s+/) : [];
  return { program: (parts[0] ?? "").slice(0, 40), argc: Math.max(0, parts.length - 1), len: command.length, sha: shortHash(command) };
}

/** Metadados de uma URL sem query/fragmento/credenciais. */
export function sanitizeUrl(url: string): Record<string, unknown> {
  try {
    const u = new URL(url);
    return { scheme: u.protocol.replace(":", ""), host: u.hostname, port: u.port || undefined, len: url.length, sha: shortHash(url) };
  } catch {
    return { invalid: true, len: url.length, sha: shortHash(url) };
  }
}
