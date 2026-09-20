import { appendFileSync, mkdirSync } from "node:fs";
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
  private file: string;

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    this.file = resolve(dir, `audit-${day}.jsonl`);
  }

  record(entry: Omit<AuditEntry, "ts">): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    try {
      appendFileSync(this.file, line + "\n", "utf8");
    } catch {
      // O audit nunca deve derrubar a operação; falha de disco é silenciosa.
    }
  }
}

/** Reduz args a metadados seguros. NUNCA registra o conteúdo bruto de strings. */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") out[k] = { len: v.length, sha: shortHash(v) };
    else out[k] = v;
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
