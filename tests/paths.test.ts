import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { safeResolve, display } from "../src/security/paths.js";

const ws = resolve("/tmp/ai-workspace");

describe("safeResolve (jaula de workspace)", () => {
  it("resolve caminho relativo simples", () => {
    expect(safeResolve(ws, "a/b.txt")).toBe(resolve(ws, "a/b.txt"));
  });

  it("permite '.' (a própria raiz)", () => {
    expect(safeResolve(ws, ".")).toBe(ws);
  });

  it("bloqueia escapar com ..", () => {
    expect(() => safeResolve(ws, "../fora.txt")).toThrow();
    expect(() => safeResolve(ws, "a/../../fora.txt")).toThrow();
  });

  it("bloqueia caminho absoluto fora da raiz", () => {
    expect(() => safeResolve(ws, "/etc/passwd")).toThrow();
    expect(() => safeResolve(ws, resolve("/tmp/outra/x"))).toThrow();
  });

  it("permite absoluto que já está dentro da raiz", () => {
    const inside = resolve(ws, "sub/x.txt");
    expect(safeResolve(ws, inside)).toBe(inside);
  });
});

describe("display", () => {
  it("mostra caminho relativo com barras normais", () => {
    expect(display(ws, resolve(ws, "a/b.txt"))).toBe("a/b.txt");
    expect(display(ws, ws)).toBe(".");
  });
});

describe("safeResolve + symlink real (jaula real)", () => {
  it("bloqueia symlink dentro do workspace que aponta para fora", () => {
    const root = mkdtempSync(join(tmpdir(), "uab-"));
    const realWs = join(root, "ws");
    const outside = join(root, "outside");
    mkdirSync(realWs, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "top secret");

    let canSymlink = true;
    try {
      // symlink de diretório: ws/link -> outside
      symlinkSync(outside, join(realWs, "link"), "junction");
    } catch {
      try {
        symlinkSync(outside, join(realWs, "link"));
      } catch {
        canSymlink = false; // sem privilégio (Windows sem dev mode): pula
      }
    }
    if (!canSymlink) {
      rmSync(root, { recursive: true, force: true });
      return;
    }

    // Lexicalmente parece dentro, mas o caminho REAL escapa → deve lançar.
    expect(() => safeResolve(realWs, "link/secret.txt")).toThrow();

    rmSync(root, { recursive: true, force: true });
  });
});
