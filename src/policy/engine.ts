import { extname } from "node:path";
import type { PolicyFile } from "../config.js";

export interface Decision {
  ok: boolean;
  reason?: string;
}

/** true se o texto contém qualquer caractere de controle (exceto whitespace comum não-perigoso). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Bloqueia 0x00-0x1F (inclui \n \r \t) e 0x7F. Espaço (0x20) é permitido.
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Detector determinístico e ciente de aspas de construções de shell que
 * permitiriam encadeamento, redirecionamento, subshell ou expansão. Retorna a
 * razão da rejeição, ou null se o comando é uma linha única segura.
 * Estados: 'none' (fora de aspas), 'single' (''), 'double' ("").
 */
export function scanShellUnsafe(command: string): string | null {
  if (hasControlChar(command)) {
    return "Caracteres de controle (quebra de linha, CR, tab, etc.) não são permitidos.";
  }
  let state: "none" | "single" | "double" = "none";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (state === "single") {
      if (c === "'") state = "none";
      continue;
    }
    if (state === "double") {
      if (c === '"') state = "none";
      else if (c === "`") return "Crase (command substitution) não é permitida.";
      else if (c === "$") return "Expansão ($) dentro de aspas duplas não é permitida — use aspas simples.";
      continue;
    }
    // state === "none"
    if (c === "'") state = "single";
    else if (c === '"') state = "double";
    else if (c === "`") return "Crase (command substitution) não é permitida.";
    else if (c === "$") return "Expansão ($) não é permitida fora de aspas simples.";
    else if (";|&<>()".includes(c)) {
      return `Metacaractere de shell "${c}" não é permitido fora de aspas — rode um comando por vez.`;
    }
  }
  if (state !== "none") return "Aspas não fechadas no comando.";
  return null;
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

    // Scanner ciente de aspas: metacaracteres só são perigosos FORA de aspas;
    // `$` e crase são perigosos exceto dentro de aspas simples. Assim,
    // `node -e "console.log(1>0)"` é permitido, mas `echo x & node ...`,
    // `> arquivo`, `$( )` e crase não. Guardrail determinístico, não sandbox.
    const unsafe = scanShellUnsafe(command);
    if (unsafe) return { ok: false, reason: unsafe };

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

  /** Visão somente-leitura da política de shell (para inspeção). */
  snapshot(): { allow: string[]; deny: string[]; denyPatterns: string[] } {
    return {
      allow: [...this.policy.shell.allow],
      deny: [...this.policy.shell.deny],
      denyPatterns: [...this.policy.shell.denyPatterns],
    };
  }

  /** Adiciona um binário à allowlist em runtime. Nunca sobrepõe a denylist. */
  addAllow(bin: string): Decision {
    const b = bin.trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(b)) return { ok: false, reason: "Nome de binário inválido." };
    if (this.policy.shell.deny.includes(b)) return { ok: false, reason: `"${b}" está na denylist e não pode ser liberado.` };
    if (!this.policy.shell.allow.includes(b)) this.policy.shell.allow.push(b);
    return { ok: true };
  }

  /** Remove um binário da allowlist em runtime. */
  removeAllow(bin: string): Decision {
    const b = bin.trim().toLowerCase();
    this.policy.shell.allow = this.policy.shell.allow.filter((x) => x !== b);
    return { ok: true };
  }
}
