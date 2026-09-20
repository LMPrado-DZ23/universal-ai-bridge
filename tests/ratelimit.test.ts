import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/security/ratelimit.js";

describe("RateLimiter", () => {
  it("bloqueia após muitas falhas de auth (lockout progressivo)", () => {
    const rl = new RateLimiter(60000, 100, 3, 1000, 5000);
    expect(rl.check("1.2.3.4").ok).toBe(true);
    rl.recordAuthFailure("1.2.3.4");
    rl.recordAuthFailure("1.2.3.4");
    expect(rl.check("1.2.3.4").ok).toBe(true); // ainda abaixo do limite
    rl.recordAuthFailure("1.2.3.4"); // 3ª falha => lock
    const r = rl.check("1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("sucesso de auth zera as falhas", () => {
    const rl = new RateLimiter(60000, 100, 2, 1000, 5000);
    rl.recordAuthFailure("9.9.9.9");
    rl.recordAuthSuccess("9.9.9.9");
    rl.recordAuthFailure("9.9.9.9");
    expect(rl.check("9.9.9.9").ok).toBe(true); // só 1 falha após reset
  });

  it("limita taxa de requisições por janela", () => {
    const rl = new RateLimiter(60000, 3, 100, 1000, 5000);
    expect(rl.check("5.5.5.5").ok).toBe(true);
    expect(rl.check("5.5.5.5").ok).toBe(true);
    expect(rl.check("5.5.5.5").ok).toBe(true);
    expect(rl.check("5.5.5.5").ok).toBe(false); // 4ª excede reqMax=3
  });

  it("IPs diferentes têm buckets independentes", () => {
    const rl = new RateLimiter(60000, 1, 100, 1000, 5000);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("b").ok).toBe(true);
  });
});
