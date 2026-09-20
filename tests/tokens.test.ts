import { describe, it, expect } from "vitest";
import { TokenStore } from "../src/security/tokens.js";

describe("TokenStore", () => {
  it("valida o token atual (constante-tempo)", () => {
    const ts = new TokenStore("segredo-inicial-1234");
    expect(ts.matches("segredo-inicial-1234")).toBe(true);
    expect(ts.matches("errado")).toBe(false);
    expect(ts.matches(undefined)).toBe(false);
  });

  it("rotate gera novo token e invalida o anterior", () => {
    const ts = new TokenStore("antigo-token-abcdefgh");
    const novo = ts.rotate();
    expect(novo).not.toBe("antigo-token-abcdefgh");
    expect(novo.length).toBeGreaterThanOrEqual(32);
    expect(ts.matches("antigo-token-abcdefgh")).toBe(false);
    expect(ts.matches(novo)).toBe(true);
  });

  it("revoke faz nada mais autenticar", () => {
    const ts = new TokenStore("qualquer-token-123456");
    ts.revoke();
    expect(ts.hasToken()).toBe(false);
    expect(ts.matches("qualquer-token-123456")).toBe(false);
  });
});
