import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("consistência de versão", () => {
  const pkg = JSON.parse(read("package.json")).version as string;

  it("package-lock.json casa com package.json", () => {
    expect(JSON.parse(read("package-lock.json")).version).toBe(pkg);
  });

  it("src/server.ts casa com package.json", () => {
    expect(read("src/server.ts")).toContain(`version: "${pkg}"`);
  });

  it("installer/UniversalAI-Bridge.iss casa com package.json", () => {
    expect(read("installer/UniversalAI-Bridge.iss")).toContain(`#define AppVersion "${pkg}"`);
  });

  it("CHANGELOG.md tem a seção da versão atual", () => {
    expect(read("CHANGELOG.md")).toContain(`## ${pkg}`);
  });
});
