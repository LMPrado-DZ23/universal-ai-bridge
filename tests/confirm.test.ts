import { describe, it, expect } from "vitest";
import { ConfirmStore } from "../src/confirm.js";

describe("ConfirmStore", () => {
  it("emite token e consome com os mesmos args", () => {
    const s = new ConfirmStore();
    const args = { path: "a.txt", content: "oi" };
    const t = s.issue("write_file", args);
    expect(s.consume(t, "write_file", args)).toBe(true);
  });

  it("token é de uso único", () => {
    const s = new ConfirmStore();
    const args = { path: "a.txt" };
    const t = s.issue("make_dir", args);
    expect(s.consume(t, "make_dir", args)).toBe(true);
    expect(s.consume(t, "make_dir", args)).toBe(false);
  });

  it("rejeita token para args diferentes (fingerprint)", () => {
    const s = new ConfirmStore();
    const t = s.issue("write_file", { path: "a.txt", content: "oi" });
    expect(s.consume(t, "write_file", { path: "a.txt", content: "OUTRO" })).toBe(false);
  });

  it("rejeita token para tool diferente", () => {
    const s = new ConfirmStore();
    const args = { path: "a.txt" };
    const t = s.issue("make_dir", args);
    expect(s.consume(t, "move_path", args)).toBe(false);
  });

  it("rejeita token inexistente", () => {
    const s = new ConfirmStore();
    expect(s.consume("naoexiste", "write_file", {})).toBe(false);
  });
});
