import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

// loadConfig lê process.env; salvamos/limpamos as chaves BRIDGE_* entre casos.
const KEYS = [
  "BRIDGE_MODE", "BRIDGE_ADMIN_ACK", "BRIDGE_TOKEN", "BRIDGE_PORT",
  "BRIDGE_APPROVAL", "BRIDGE_ALLOW_SHELL", "BRIDGE_ALLOW_DOCKER",
  "BRIDGE_WORKSPACE", "BRIDGE_ALLOWED_ORIGINS", "BRIDGE_ALLOWED_HOSTS", "BRIDGE_ENV_FILE",
  "BRIDGE_ADMIN_PORT", "BRIDGE_MAX_SESSIONS", "BRIDGE_DATA_DIR", "BRIDGE_ADMIN_SECRET",
];
function clear() {
  for (const k of KEYS) delete process.env[k];
}
afterEach(clear);

describe("loadConfig fail-closed (C13)", () => {
  it("porta inválida falha", () => {
    clear();
    process.env.BRIDGE_PORT = "abc";
    expect(() => loadConfig()).toThrow(/BRIDGE_PORT/);
    process.env.BRIDGE_PORT = "0";
    expect(() => loadConfig()).toThrow(/BRIDGE_PORT/);
    process.env.BRIDGE_PORT = "65536";
    expect(() => loadConfig()).toThrow(/BRIDGE_PORT/);
    process.env.BRIDGE_PORT = "-1";
    expect(() => loadConfig()).toThrow(/BRIDGE_PORT/);
  });

  it("approval inválido falha (não cai em confirm em silêncio)", () => {
    clear();
    process.env.BRIDGE_APPROVAL = "garbage";
    expect(() => loadConfig()).toThrow(/BRIDGE_APPROVAL/);
  });

  it("mode inválido falha", () => {
    clear();
    process.env.BRIDGE_MODE = "root";
    expect(() => loadConfig()).toThrow(/BRIDGE_MODE/);
  });

  it("admin sem ACK falha", () => {
    clear();
    process.env.BRIDGE_MODE = "admin";
    expect(() => loadConfig()).toThrow(/reconhecimento|ADMIN_ACK/i);
  });

  it("token placeholder / curto é rejeitado", () => {
    clear();
    process.env.BRIDGE_TOKEN = "troque-por-um-token-aleatorio-forte";
    expect(() => loadConfig()).toThrow(/TOKEN/);
    process.env.BRIDGE_TOKEN = "curto";
    expect(() => loadConfig()).toThrow(/TOKEN/);
  });

  it("adminPort derivado inválido (BRIDGE_PORT=65535) falha (C4)", () => {
    clear();
    process.env.BRIDGE_PORT = "65535";
    process.env.BRIDGE_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(() => loadConfig()).toThrow(/admin/i);
  });

  it("adminPort explícito válido com BRIDGE_PORT=65535 funciona", () => {
    clear();
    process.env.BRIDGE_PORT = "65535";
    process.env.BRIDGE_ADMIN_PORT = "8788";
    process.env.BRIDGE_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(loadConfig().adminPort).toBe(8788);
  });

  it("config válida (safe) carrega", () => {
    clear();
    process.env.BRIDGE_PORT = "8787";
    process.env.BRIDGE_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const cfg = loadConfig();
    expect(cfg.mode).toBe("safe");
    expect(cfg.port).toBe(8787);
    expect(cfg.allowShell).toBe(false);
  });
});
