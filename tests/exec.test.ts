import { describe, it, expect } from "vitest";
import { parseCommand, runStructuredSync, resolveExecutable } from "../src/exec.js";
import { PolicyEngine } from "../src/policy/engine.js";
import type { PolicyFile } from "../src/config.js";

const policy: PolicyFile = {
  shell: { allow: ["node", "npm", "python"], deny: ["rm"], denyPatterns: [], maxOutputBytes: 1e6, timeoutMs: 60000 },
  files: { deniedExtensions: [], maxWriteBytes: 1e6, maxReadBytes: 1e6, listMaxEntries: 100 },
};

describe("parseCommand (parser restrito, sem shell)", () => {
  it("converte command legado em program+args", () => {
    expect(parseCommand('node -e "a b"')).toEqual({ program: "node", args: ["-e", "a b"] });
  });
  it("rejeita encadeamento e controle", () => {
    expect(() => parseCommand("echo A & node -e x")).toThrow();
    expect(() => parseCommand("echo A\nnode -e x")).toThrow();
    expect(() => parseCommand("node -e $(whoami)")).toThrow();
  });
});

describe("PolicyEngine.checkProgram", () => {
  const e = new PolicyEngine(policy);
  it("permite binário da allowlist", () => expect(e.checkProgram("node").ok).toBe(true));
  it("nega denylist", () => expect(e.checkProgram("rm").ok).toBe(false));
  it("nega fora da allowlist", () => expect(e.checkProgram("curl").ok).toBe(false));
  it("nega caminho (deve ser nome puro)", () => {
    expect(e.checkProgram("/usr/bin/node").ok).toBe(false);
    expect(e.checkProgram("C:\\evil\\node.exe").ok).toBe(false);
  });
});

describe("runStructuredSync (shell:false)", () => {
  it("roda um exe real (node) com args", () => {
    const r = runStructuredSync(process.execPath, ["-e", "process.stdout.write('EXECOK')"], { cwd: process.cwd() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("EXECOK");
  });

  it("roda npm (.cmd no Windows / real no POSIX) via resolução seseura", () => {
    // Só roda se npm estiver no PATH deste ambiente.
    if (!resolveExecutable("npm")) return;
    const r = runStructuredSync("npm", ["--version"], { cwd: process.cwd(), timeout: 30000 });
    expect(r.status).toBe(0);
    expect((r.stdout || "").trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("não interpreta metacaracteres nos args (sem shell)", () => {
    // '&&echo PWNED' deve chegar como UM argumento literal (um shell o dividiria/executaria).
    const r = runStructuredSync(process.execPath, ["-e", "process.stdout.write(process.argv[1]||'')", "&&echo PWNED"], { cwd: process.cwd() });
    expect(r.status).toBe(0);
    expect((r.stdout || "").trim()).toBe("&&echo PWNED"); // literal, não executado
  });
});
