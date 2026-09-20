import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
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
