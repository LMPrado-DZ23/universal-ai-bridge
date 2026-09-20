import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Atualiza (ou insere) uma chave num conteúdo estilo .env. */
function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  return content.endsWith("\n") || content === "" ? content + line + "\n" : content + "\n" + line + "\n";
}

/**
 * Guarda o token HTTP atual e permite rotação/revogação em runtime.
 * Quando `envFile` existe, a rotação é PERSISTIDA (escrita atômica: temp +
 * rename, sem BOM, permissão 0600), então sobrevive a reinícios.
 */
export class TokenStore {
  private current: string | undefined;

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
    const tmp = join(dirname(this.envFile), `.env.rot.${randomBytes(4).toString("hex")}`);
    writeFileSync(tmp, next, { encoding: "utf8", mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* Windows ACL */ }
    renameSync(tmp, this.envFile); // troca atômica
  }

  /** Gera e passa a exigir um novo token; persiste se possível. Devolve o valor. */
  rotate(): string {
    const token = randomBytes(32).toString("hex");
    this.current = token;
    try { this.persist(token); } catch { /* mantém em memória mesmo se a escrita falhar */ }
    return token;
  }

  revoke(): void {
    this.current = undefined;
  }
}
