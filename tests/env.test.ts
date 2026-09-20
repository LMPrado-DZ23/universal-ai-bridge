import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyEnvFile } from "../src/config.js";

describe("applyEnvFile (.env carrega de verdade)", () => {
  it("carrega variáveis de um .env para process.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "uab-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, "UAB_TEST_KEY=valor123\n", "utf8");

    delete process.env.UAB_TEST_KEY;
    const okLoaded = applyEnvFile(file);
    expect(okLoaded).toBe(true);
    expect(process.env.UAB_TEST_KEY).toBe("valor123");

    delete process.env.UAB_TEST_KEY;
    rmSync(dir, { recursive: true, force: true });
  });

  it("retorna false silenciosamente se o arquivo não existe", () => {
    expect(applyEnvFile(join(tmpdir(), "nao-existe-uab.env"))).toBe(false);
  });
});
