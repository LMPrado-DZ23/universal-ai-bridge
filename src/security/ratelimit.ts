interface Bucket {
  count: number;
  windowStart: number;
  fails: number;
  lockedUntil: number;
}

export interface LimitResult {
  ok: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/**
 * Rate limiting por IP + bloqueio progressivo de tentativas de auth falhas.
 * Tudo em memória (o produto é single-host). Sem detalhes internos nas respostas.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private reqWindowMs = 60_000,
    private reqMax = 240,
    private failMax = 6,
    private lockBaseMs = 30_000,
    private lockMaxMs = 15 * 60_000,
    private capacity = 4096
  ) {
    this.timer = setInterval(() => this.sweep(), 5 * 60_000);
    (this.timer as { unref?: () => void }).unref?.();
  }

  dispose(): void { clearInterval(this.timer); this.buckets.clear(); }

  private get(ip: string): Bucket | undefined {
    let b = this.buckets.get(ip);
    if (!b) {
      this.sweep();
      if (this.buckets.size >= this.capacity) return undefined;
      b = { count: 0, windowStart: Date.now(), fails: 0, lockedUntil: 0 };
      this.buckets.set(ip, b);
    }
    return b;
  }

  /** Chame antes de processar a requisição. */
  check(ip: string): LimitResult {
    const now = Date.now();
    const b = this.get(ip);
    if (!b) return {ok:false,reason:"Limite excedido.",retryAfterMs:this.reqWindowMs};
    if (b.lockedUntil > now) {
      return { ok: false, reason: "Temporariamente bloqueado por tentativas inválidas.", retryAfterMs: b.lockedUntil - now };
    }
    if (now - b.windowStart > this.reqWindowMs) {
      b.windowStart = now;
      b.count = 0;
    }
    b.count++;
    if (b.count > this.reqMax) {
      return { ok: false, reason: "Muitas requisições.", retryAfterMs: this.reqWindowMs - (now - b.windowStart) };
    }
    return { ok: true };
  }

  /** Registre uma falha de autenticação (token inválido). */
  recordAuthFailure(ip: string): void {
    const b = this.get(ip);
    if (!b) return;
    b.fails++;
    if (b.fails >= this.failMax) {
      const over = b.fails - this.failMax;
      const lock = Math.min(this.lockBaseMs * 2 ** over, this.lockMaxMs);
      b.lockedUntil = Date.now() + lock;
    }
  }

  /** Autenticação bem-sucedida zera o contador de falhas. */
  recordAuthSuccess(ip: string): void {
    const b = this.get(ip);
    if (!b) return;
    b.fails = 0;
    b.lockedUntil = 0;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ip, b] of this.buckets) {
      if (b.lockedUntil < now && now - b.windowStart > this.reqWindowMs * 4) {
        this.buckets.delete(ip);
      }
    }
  }
}
