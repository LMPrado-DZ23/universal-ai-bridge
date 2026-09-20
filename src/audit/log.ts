import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

/** Reduz args a metadados seguros (tamanhos, não conteúdo). */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "content" && typeof v === "string") out[k] = `<${v.length} chars>`;
    else if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 200) + "…";
    else out[k] = v;
  }
  return out;
}
