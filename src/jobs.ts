import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

const IS_WIN = process.platform === "win32";

/** Mata a árvore de processos (o filho e seus descendentes). */
export function killTree(pid: number): void {
  if (IS_WIN) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    // Filhos são criados com detached:true → matamos o grupo inteiro (-pid).
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* já morto */
      }
    }
  }
}

export interface JobView {
  id: string;
  command: string;
  running: boolean;
  exitCode: number | null;
  startedAt: string;
  stdoutLen: number;
  stderrLen: number;
  truncated: boolean;
}

interface Job {
  id: string;
  command: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
  truncated: boolean;
}

/**
 * Gerencia processos assíncronos de longa duração. Cada job tem saída
 * bufferizada (com teto), aceita stdin e pode ser cancelado com kill de árvore.
 */
export class JobManager {
  private jobs = new Map<string, Job>();
  private static all = new Set<JobManager>();

  constructor(private maxBufferBytes = 1_000_000) {
    JobManager.all.add(this);
  }

  /** Mata todos os jobs de todas as instâncias (usado no shutdown). */
  static killAllEverywhere(): void {
    for (const mgr of JobManager.all) mgr.killAll();
  }

  /**
   * Inicia um job. `command` DEVE ter passado pela PolicyEngine.checkCommand
   * antes (allowlist + zero metacaracteres de shell). Usamos shell:true só
   * para resolver binários como npm/npx no Windows — como a política já barrou
   * `; | && || \` $() < >`, o shell recebe um único binário + argumentos simples.
   */
  start(command: string, cwd: string): string {
    const id = randomBytes(6).toString("hex");
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: !IS_WIN, // POSIX: novo grupo p/ matar a árvore
      windowsHide: true,
    });

    const job: Job = {
      id,
      command,
      child,
      stdout: "",
      stderr: "",
      running: true,
      exitCode: null,
      startedAt: Date.now(),
      truncated: false,
    };

    const append = (key: "stdout" | "stderr", chunk: Buffer) => {
      if (job[key].length >= this.maxBufferBytes) {
        job.truncated = true;
        return;
      }
      job[key] += chunk.toString("utf8");
      if (job[key].length > this.maxBufferBytes) {
        job[key] = job[key].slice(0, this.maxBufferBytes);
        job.truncated = true;
      }
    };

    child.stdout?.on("data", (c: Buffer) => append("stdout", c));
    child.stderr?.on("data", (c: Buffer) => append("stderr", c));
    child.on("error", (err) => {
      job.stderr += `\n[spawn error] ${String(err)}`;
      job.running = false;
      job.exitCode = -1;
    });
    child.on("exit", (code) => {
      job.exitCode = code;
      job.running = false;
    });

    this.jobs.set(id, job);
    return id;
  }

  private get(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`Job não encontrado: ${id}`);
    return j;
  }

  view(id: string): JobView {
    const j = this.get(id);
    return {
      id: j.id,
      command: j.command,
      running: j.running,
      exitCode: j.exitCode,
      startedAt: new Date(j.startedAt).toISOString(),
      stdoutLen: j.stdout.length,
      stderrLen: j.stderr.length,
      truncated: j.truncated,
    };
  }

  list(): JobView[] {
    return [...this.jobs.keys()].map((id) => this.view(id));
  }

  /** Saída incremental: devolve o que há a partir dos cursores dados. */
  output(id: string, sinceOut = 0, sinceErr = 0) {
    const j = this.get(id);
    return {
      running: j.running,
      exitCode: j.exitCode,
      truncated: j.truncated,
      stdout: j.stdout.slice(sinceOut),
      stderr: j.stderr.slice(sinceErr),
      nextStdoutCursor: j.stdout.length,
      nextStderrCursor: j.stderr.length,
    };
  }

  write(id: string, input: string): void {
    const j = this.get(id);
    if (!j.running) throw new Error("Job já terminou; não é possível escrever no stdin.");
    j.child.stdin?.write(input);
  }

  cancel(id: string): void {
    const j = this.get(id);
    if (j.child.pid) killTree(j.child.pid);
    j.running = false;
  }

  killAll(): void {
    for (const id of this.jobs.keys()) {
      try {
        this.cancel(id);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Tokeniza um comando respeitando aspas duplas simples. */
export function tokenize(command: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}
