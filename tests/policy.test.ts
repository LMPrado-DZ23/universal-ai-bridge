import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/policy/engine.js";
import type { PolicyFile } from "../src/config.js";

const policy: PolicyFile = {
  shell: {
    allow: ["node", "npm", "python", "git"],
    deny: ["rm", "curl", "shutdown"],
    denyPatterns: ["rm\\s+-rf", "drop\\s+table", "\\bformat\\b"],
    maxOutputBytes: 100000,
    timeoutMs: 60000,
  },
  files: {
    deniedExtensions: [".exe", ".bat", ".ps1"],
    maxWriteBytes: 1000,
    maxReadBytes: 1000,
    listMaxEntries: 100,
  },
};

describe("PolicyEngine.checkCommand", () => {
  const e = new PolicyEngine(policy);

  it("permite binário da allowlist", () => {
    expect(e.checkCommand("npm install").ok).toBe(true);
    expect(e.checkCommand("python main.py").ok).toBe(true);
  });

  it("nega binário fora da allowlist", () => {
    expect(e.checkCommand("ping google.com").ok).toBe(false);
  });

  it("nega binário da denylist", () => {
    expect(e.checkCommand("rm arquivo").ok).toBe(false);
    expect(e.checkCommand("curl http://x").ok).toBe(false);
  });

  it("nega padrão perigoso mesmo se o binário parecer ok", () => {
    expect(e.checkCommand("rm -rf /").ok).toBe(false);
    expect(e.checkCommand("node script drop table users").ok).toBe(false);
  });

  it("nega encadeamento de comandos", () => {
    expect(e.checkCommand("npm install && rm -rf .").ok).toBe(false);
    expect(e.checkCommand("git status | grep x").ok).toBe(false);
    expect(e.checkCommand("node a.js; node b.js").ok).toBe(false);
    expect(e.checkCommand("echo $(whoami)").ok).toBe(false);
  });

  it("nega redirecionamento (> <)", () => {
    expect(e.checkCommand("node a.js > /etc/passwd").ok).toBe(false);
    expect(e.checkCommand("python x.py < input").ok).toBe(false);
  });

  it("nega comando vazio", () => {
    expect(e.checkCommand("   ").ok).toBe(false);
  });
});

describe("PolicyEngine.checkWriteTarget", () => {
  const e = new PolicyEngine(policy);

  it("permite extensão comum dentro do limite", () => {
    expect(e.checkWriteTarget("main.py", 500).ok).toBe(true);
  });

  it("nega extensão proibida", () => {
    expect(e.checkWriteTarget("virus.exe", 10).ok).toBe(false);
    expect(e.checkWriteTarget("run.ps1", 10).ok).toBe(false);
  });

  it("nega arquivo acima do limite de bytes", () => {
    expect(e.checkWriteTarget("grande.txt", 2000).ok).toBe(false);
  });
});
