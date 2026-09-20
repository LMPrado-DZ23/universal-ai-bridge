import { writePrivateAtomic } from "./private-file.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Atualiza (ou insere) uma chave num conteúdo estilo .env. */
function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const lines = content.split(/\r?\n/).filter(l => !new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(l));
  while(lines.at(-1)==='')lines.pop();
  return [...lines,line,''].join('\n');
}

/**
 * Guarda o token HTTP atual e permite rotação/revogação em runtime.
 * Quando `envFile` existe, a rotação é PERSISTIDA (escrita atômica: temp +
 * rename, sem BOM, permissão 0600), então sobrevive a reinícios.
 */
export class TokenStore {
  private current: string | undefined;
  persistence: "persisted" | "memory-only" | "failed" = "memory-only";

  constructor(initial: string | undefined, private envFile?: string) {
    this.current = initial;
  }

  hasToken(): boolean {
    return !!this.current;
  }

  matches(provided: string | undefined): boolean {
    if (!this.current || !provided) return false;
    return safeEqual(provided, this.current);
  }

  /** true se a rotação será persistida em disco (arquivo .env existe). */
  get persists(): boolean {
    return !!this.envFile && existsSync(this.envFile);
  }

  private persist(token: string): void {
    if (!this.envFile || !existsSync(this.envFile)) return;
    const cur = readFileSync(this.envFile, "utf8");
    const next = upsertEnvLine(cur, "BRIDGE_TOKEN", token);
    writePrivateAtomic(this.envFile, next);
    if (readFileSync(this.envFile, 'utf8') !== next) throw new Error('Persistência não verificada.');
  }

  /** Gera e passa a exigir um novo token; persiste se possível. Devolve o valor. */
  rotate(): string {
    const token = randomBytes(32).toString("hex");
    this.current = token;
    try { this.persist(token); this.persistence = this.persists ? "persisted" : "memory-only"; } catch { this.persistence = "failed"; }
    return token;
  }

  revoke(): void {
    this.current = undefined;
    try {this.persist(""); this.persistence=this.persists?"persisted":"memory-only";}catch{this.persistence="failed";}
  }
}
