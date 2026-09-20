import { randomBytes, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Guarda o token válido atual do transporte HTTP e permite rotação/revogação
 * em runtime (controle local). A rotação invalida o token anterior na hora.
 */
export class TokenStore {
  private current: string | undefined;

  constructor(initial: string | undefined) {
    this.current = initial;
  }

  hasToken(): boolean {
    return !!this.current;
  }

  matches(provided: string | undefined): boolean {
    if (!this.current || !provided) return false;
    return safeEqual(provided, this.current);
  }

  /** Gera e passa a exigir um novo token; devolve o novo valor. */
  rotate(): string {
    this.current = randomBytes(32).toString("hex");
    return this.current;
  }

  /** Revoga o token (nenhuma sessão nova autentica até rotacionar). */
  revoke(): void {
    this.current = undefined;
  }
}
