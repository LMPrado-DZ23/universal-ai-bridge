import { randomBytes } from "node:crypto";

interface Pending {
  token: string;
  fingerprint: string;
  expires: number;
}

/**
 * Guarda ações pendentes de confirmação. Quando approval=confirm, um tool com
 * efeito colateral primeiro devolve um token; a IA reenvia com o token para executar.
 * O fingerprint garante que o token só vale para EXATAMENTE aquela ação.
 */
export class ConfirmStore {
  private pending = new Map<string, Pending>();
  private ttlMs = 5 * 60 * 1000;

  private fingerprint(tool: string, args: Record<string, unknown>): string {
    return `${tool}:${JSON.stringify(args)}`;
  }

  issue(tool: string, args: Record<string, unknown>): string {
    const token = randomBytes(9).toString("hex");
    this.pending.set(token, {
      token,
      fingerprint: this.fingerprint(tool, args),
      expires: Date.now() + this.ttlMs,
    });
    return token;
  }

  /** Consome o token se válido e casar com a ação. Uso único. */
  consume(token: string, tool: string, args: Record<string, unknown>): boolean {
    const p = this.pending.get(token);
    if (!p) return false;
    this.pending.delete(token);
    if (Date.now() > p.expires) return false;
    return p.fingerprint === this.fingerprint(tool, args);
  }
}
