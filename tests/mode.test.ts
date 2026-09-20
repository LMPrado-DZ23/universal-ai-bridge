import { describe, it, expect } from "vitest";
import { resolveMode, ADMIN_ACK_PHRASE } from "../src/config.js";

describe("resolveMode (safe vs admin)", () => {
  it("safe é o padrão quando nada é definido", () => {
    const r = resolveMode({});
    expect(r.mode).toBe("safe");
    expect(r.allowShell).toBe(false);
    expect(r.allowDocker).toBe(false);
  });

  it("safe: shell só liga com valor explícito 'true'", () => {
    expect(resolveMode({ BRIDGE_ALLOW_SHELL: "true" }).allowShell).toBe(true);
    expect(resolveMode({ BRIDGE_ALLOW_SHELL: "1" }).allowShell).toBe(false);
    expect(resolveMode({ BRIDGE_ALLOW_SHELL: "" }).allowShell).toBe(false);
  });

  it("safe NUNCA habilita Docker, mesmo com a flag", () => {
    expect(resolveMode({ BRIDGE_ALLOW_DOCKER: "true" }).allowDocker).toBe(false);
  });

  it("admin sem reconhecimento LANÇA (não sobe por acidente)", () => {
    expect(() => resolveMode({ BRIDGE_MODE: "admin" })).toThrow();
    expect(() => resolveMode({ BRIDGE_MODE: "admin", BRIDGE_ADMIN_ACK: "qualquer" })).toThrow();
  });

  it("admin com reconhecimento correto habilita shell por padrão", () => {
    const r = resolveMode({ BRIDGE_MODE: "admin", BRIDGE_ADMIN_ACK: ADMIN_ACK_PHRASE });
    expect(r.mode).toBe("admin");
    expect(r.allowShell).toBe(true);
    expect(r.allowDocker).toBe(false);
  });

  it("admin habilita Docker só com a flag explícita", () => {
    const r = resolveMode({
      BRIDGE_MODE: "admin",
      BRIDGE_ADMIN_ACK: ADMIN_ACK_PHRASE,
      BRIDGE_ALLOW_DOCKER: "true",
    });
    expect(r.allowDocker).toBe(true);
  });
});
