import { extname } from "node:path";
import type { PolicyFile } from "../config.js";

export interface Decision {
  ok: boolean;
  reason?: string;
}

/**
 * Policy Engine 100% determinístico (sem IA). O modelo propõe; este código decide.
 */
export class PolicyEngine {
  constructor(private policy: PolicyFile) {}

  /** Valida a extensão de um arquivo que será escrito. */
  checkWriteTarget(path: string, byteLength: number): Decision {
    const ext = extname(path).toLowerCase();
    if (this.policy.files.deniedExtensions.includes(ext)) {
      return { ok: false, reason: `Extensão bloqueada por política: ${ext}` };
    }
    if (byteLength > this.policy.files.maxWriteBytes) {
      return {
        ok: false,
        reason: `Arquivo excede o limite (${byteLength} > ${this.policy.files.maxWriteBytes} bytes)`,
      };
    }
    return { ok: true };
  }

  /** Valida um comando de shell contra allowlist, denylist e padrões perigosos. */
  checkCommand(command: string): Decision {
    const normalized = command.trim().toLowerCase();
    if (!normalized) return { ok: false, reason: "Comando vazio" };

    for (const pattern of this.policy.shell.denyPatterns) {
      if (new RegExp(pattern, "i").test(command)) {
        return { ok: false, reason: `Padrão perigoso bloqueado: /${pattern}/` };
      }
    }

    // Primeiro token = binário. Bloqueia encadeamento (; | && || ` $()).
    if (/[;`]|\|\||&&|\$\(|\|/.test(command)) {
      return {
        ok: false,
        reason: "Encadeamento de comandos não é permitido (rode um comando por vez)",
      };
    }

    const bin = normalized.split(/\s+/)[0].replace(/\.exe$/, "");
    if (this.policy.shell.deny.includes(bin)) {
      return { ok: false, reason: `Binário na denylist: ${bin}` };
    }
    if (!this.policy.shell.allow.includes(bin)) {
      return {
        ok: false,
        reason: `Binário fora da allowlist: ${bin}. Edite config/policy.json para liberar.`,
      };
    }
    return { ok: true };
  }

  get shellTimeoutMs(): number {
    return this.policy.shell.timeoutMs;
  }
  get shellMaxOutput(): number {
    return this.policy.shell.maxOutputBytes;
  }
}
