import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

  it("rotate PERSISTE no .env quando o arquivo existe (C6)", () => {
    const dir = mkdtempSync(join(tmpdir(), "uab-tok-"));
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "BRIDGE_MODE=safe\nBRIDGE_TOKEN=token-antigo-0123456789ab\nBRIDGE_PORT=8787\n");
    const ts = new TokenStore("token-antigo-0123456789ab", envFile);
    expect(ts.persists).toBe(true);
    const novo = ts.rotate();
    const onDisk = readFileSync(envFile, "utf8");
    expect(onDisk).toContain(`BRIDGE_TOKEN=${novo}`);
    expect(onDisk).not.toContain("token-antigo-0123456789ab");
    // preserva outras chaves
    expect(onDisk).toContain("BRIDGE_MODE=safe");
    rmSync(dir, { recursive: true, force: true });
  });

  it("sem arquivo .env, rotate fica só em memória (persists=false)", () => {
    const ts = new TokenStore("x".repeat(20), join(tmpdir(), "nao-existe-uab.env"));
    expect(ts.persists).toBe(false);
    const novo = ts.rotate();
    expect(ts.matches(novo)).toBe(true);
  });
});
