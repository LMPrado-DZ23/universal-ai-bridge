import type { Config } from "../config.js";
import { PolicyEngine } from "../policy/engine.js";
import { ConfirmStore } from "../confirm.js";
import { Audit, sanitizeArgs } from "../audit/log.js";
import { JobManager } from "../jobs.js";

export interface Ctx {
  config: Config;
  policy: PolicyEngine;
  confirm: ConfirmStore;
  audit: Audit;
  jobs: JobManager;
}

export const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
export const fail = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

export type GateResult =
  | { proceed: true }
  | { proceed: false; result: ReturnType<typeof ok> };

/**
 * Portão de aprovação para ações com efeito colateral.
 * - auto: executa direto.
 * - confirm: two-step no mesmo canal da IA (NÃO é aprovação humana out-of-band).
 * - local: código sai só no console local; humano precisa relé-lo à IA.
 */
export function gate(
  ctx: Ctx,
  tool: string,
  coreArgs: Record<string, unknown>,
  confirmToken: string | undefined
): GateResult {
  if (ctx.config.approval === "auto") return { proceed: true };

  if (!confirmToken) {
    const token = ctx.confirm.issue(tool, coreArgs);
    ctx.audit.record({ tool, decision: "confirm-required", args: sanitizeArgs(coreArgs) });

    if (ctx.config.approval === "local") {
      process.stderr.write(
        `\n[APROVAÇÃO LOCAL] ${tool} ${JSON.stringify(sanitizeArgs(coreArgs))}\n` +
          `  código: ${token}\n` +
          `  (informe este código à IA para autorizar; expira em 5 min)\n`
      );
      return {
        proceed: false,
        result: ok(
          `⚠️ A ação "${tool}" exige APROVAÇÃO LOCAL. Um código foi exibido no console do ` +
            `computador do usuário. Peça esse código ao usuário e chame "${tool}" de novo com ` +
            `os MESMOS argumentos e confirm_token=<código>.`
        ),
      };
    }

    return {
      proceed: false,
      result: ok(
        `⚠️ Confirmação necessária para "${tool}".\n` +
          `Ação: ${JSON.stringify(sanitizeArgs(coreArgs))}\n` +
          `Para executar, chame "${tool}" de novo com os MESMOS argumentos e confirm_token="${token}".`
      ),
    };
  }

  if (!ctx.confirm.consume(confirmToken, tool, coreArgs)) {
    return {
      proceed: false,
      result: fail(
        "Token de confirmação inválido, expirado ou não corresponde à ação. Refaça sem confirm_token para obter um novo."
      ),
    };
  }
  return { proceed: true };
}
