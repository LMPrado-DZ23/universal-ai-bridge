import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobManager, tokenize } from "../src/jobs.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nodeBin = `"${process.execPath}"`;

async function waitDone(m: JobManager, id: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!m.view(id).running) return;
    await wait(50);
  }
  throw new Error("job não terminou a tempo");
}

describe("tokenize", () => {
  it("respeita aspas", () => {
    expect(tokenize('node -e "a b"')).toEqual(["node", "-e", "a b"]);
  });
});

describe("JobManager", () => {
  it("roda um job e captura stdout + exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uab-job-"));
    const m = new JobManager();
    const id = m.start(`${nodeBin} -e "process.stdout.write('ola-job')"`, dir);
    await waitDone(m, id);
    const out = m.output(id);
    expect(out.stdout).toContain("ola-job");
    expect(m.view(id).exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("cancela um job de longa duração (mata a árvore)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uab-job-"));
    const m = new JobManager();
    const id = m.start(`${nodeBin} -e "setInterval(()=>{},1000)"`, dir);
    await wait(300);
    expect(m.view(id).running).toBe(true);
    m.cancel(id);
    await wait(500);
    expect(m.view(id).running).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("saída incremental avança com o cursor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uab-job-"));
    const m = new JobManager();
    const id = m.start(`${nodeBin} -e "process.stdout.write('abcdef')"`, dir);
    await waitDone(m, id);
    const first = m.output(id, 0, 0);
    expect(first.stdout).toContain("abcdef");
    const second = m.output(id, first.nextStdoutCursor, first.nextStderrCursor);
    expect(second.stdout).toBe(""); // nada novo depois do cursor
    rmSync(dir, { recursive: true, force: true });
  });
});
