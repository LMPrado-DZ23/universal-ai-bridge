import { DEFAULT_LIMITS, type ResourceLimits } from "./config.js";
import { spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { spawnStructured } from "./exec.js";

const IS_WIN = process.platform === "win32";

/** Mata a árvore de processos (o filho e seus descendentes). */
export function killTree(pid: number): void {
  if (IS_WIN) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
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
  endedAt?: number;
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
  endedAt?: number;
}

/**
 * Gerencia processos assíncronos de longa duração. Cada job tem saída
 * bufferizada (com teto), aceita stdin e pode ser cancelado com kill de árvore.
 */
export class JobManager {
  private jobs = new Map<string, Job>();
  private static all = new Set<JobManager>();

  private destroyed = false;
  private sweepTimer: ReturnType<typeof setInterval>;
  constructor(private maxBufferBytes = 1_000_000, private limits: ResourceLimits = DEFAULT_LIMITS) {
    JobManager.all.add(this);
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(limits.jobTtlMs, 10000));
    this.sweepTimer.unref();
  }
  sweep(): void {
    for (const [id, j] of this.jobs) if (!j.running && j.endedAt !== undefined && Date.now() - j.endedAt >= this.limits.jobTtlMs) this.jobs.delete(id);
  }
  private active(): number { return [...this.jobs.values()].filter(j => j.running).length; }
  private outputBytes(): number { return [...this.jobs.values()].reduce((n,j) => n + Buffer.byteLength(j.stdout) + Buffer.byteLength(j.stderr), 0); }
  async run(program: string, args: string[], cwd: string, env: Record<string,string>, timeout: number) {
    const id = this.start(program, args, cwd, env);
    const j = this.get(id);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; this.cancel(id); }, timeout);
    try {
      await new Promise<void>(resolve => {
        j.child.once('close', () => resolve());
      });
      return { status: j.exitCode, stdout: j.stdout, stderr: j.stderr, truncated: j.truncated, timedOut };
    } finally { clearTimeout(timer); this.jobs.delete(id); }
  }

  /** Mata todos os jobs de todas as instâncias (usado no shutdown). */
  static killAllEverywhere(): void {
    for (const mgr of JobManager.all) mgr.killAll();
  }

  /**
   * Inicia um job com execução ESTRUTURADA (program + args[], shell:false).
   * `program` deve ter passado por PolicyEngine.checkProgram antes.
   */
  start(program: string, args: string[], cwd: string, extraEnv?: Record<string, string>): string {
    if (this.destroyed) throw new Error("Sessão encerrada.");
    this.sweep();
    const globalActive = [...JobManager.all].reduce((n,m) => n + m.active(), 0);
    if (this.active() >= this.limits.activeJobs || globalActive >= this.limits.globalJobs) throw new Error("Limite de jobs ativos atingido.");
    if (this.jobs.size >= this.limits.retainedJobs) throw new Error("Limite de jobs retidos atingido; aguarde o TTL.");
    const id = randomBytes(6).toString("hex");
    const child = spawnStructured(program, args, { cwd, env: extraEnv });

    const job: Job = {
      id,
      command: `${program} ${args.join(" ")}`.trim(),
      child,
      stdout: "",
      stderr: "",
      running: true,
      exitCode: null,
      startedAt: Date.now(),
      truncated: false,
    };

    const append = (key: "stdout" | "stderr", chunk: Buffer) => {
      const room = Math.max(0, Math.min(this.maxBufferBytes - Buffer.byteLength(job.stdout) - Buffer.byteLength(job.stderr), this.limits.outputBytes - this.outputBytes()));
      const text = chunk.subarray(0, room).toString("utf8");
      // Remove an incomplete UTF-8 tail rather than exceeding the byte budget.
      let bounded = text;
      while (Buffer.byteLength(bounded) > room) bounded = bounded.slice(0, -1);
      job[key] += bounded;
      if (chunk.length > room) job.truncated = true;
    };

    child.stdin?.on("error", () => append("stderr", Buffer.from("[stdin unavailable]")));
    child.stdout?.on("data", (c: Buffer) => append("stdout", c));
    child.stderr?.on("data", (c: Buffer) => append("stderr", c));
    child.on("error", (err) => {
      append("stderr", Buffer.from("[spawn error] " + (err as NodeJS.ErrnoException).code));
      job.endedAt = Date.now();
      job.running = false;
      job.exitCode = -1;
    });
    child.on("close", (code) => {
      job.endedAt = Date.now();
      job.exitCode = code;
      job.running = false;
    });

    this.jobs.set(id, job);
    return id;
  }

  private get(id: string): Job {
    this.sweep();
    const j = this.jobs.get(id);
    if (!j) throw new Error(`Job não encontrado: ${id}`);
    return j;
  }

  /** true se o PID pertence a um job iniciado por este manager. */
  ownsPid(pid: number): boolean {
    for (const j of this.jobs.values()) {
      if (j.running && j.child.pid === pid) return true;
    }
    return false;
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
    this.sweep();
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
    if (Buffer.byteLength(input) > this.limits.stdinBytes || (j.child.stdin?.writableLength ?? 0) + Buffer.byteLength(input) > this.limits.stdinBytes) throw new Error("Limite de stdin atingido.");
    j.child.stdin?.write(input);
  }

  cancel(id: string): void {
    const j = this.get(id);
    if (j.running && j.child.pid) killTree(j.child.pid);
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

  /** Encerra tudo e remove do registro estático (cleanup de sessão). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.sweepTimer);
    this.killAll();
    this.jobs.clear();
    JobManager.all.delete(this);
  }
}
